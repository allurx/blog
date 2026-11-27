---
title: 分块读取 UTF-8 文件，为什么一个“茶”字会变成三个 �？
date: 2026-11-27
domain: JavaScript
tags: [UTF-8, TextDecoder, 流式解码]
---

一个 UTF-8 文件只有五个字节，内容是 `A茶B`。一次读完，一切正常。把同样的字节分三次交给 JavaScript，结果却可能是 `A���B`。文件没变，读取顺序也没变。差别在于：解码器把哪一次调用当成了文件结束？

## 五个字节，三个读取块

`A` 和 `B` 各占一个字节。中间的“茶”是 Unicode 码点 `U+8336`，用 UTF-8 编码为 `E8 8C B6`。首字节 `E8` 表明这个序列共有三个字节，后两个字节承担续接作用。文件读取接口按字节切块时，完全可以把这三个字节分到三个块中。

下面用同一个 `TextDecoder` 做两组对照，每组都按同样的顺序送入字节。示例在 Linux x86-64、Node.js 24.21.0 上运行，保存为 `chunks.mjs` 后执行 `node chunks.mjs` 即可，无需安装依赖。

```js
const chunks = [
    Uint8Array.of(0x41, 0xe8),
    Uint8Array.of(0x8c),
    Uint8Array.of(0xb6, 0x42),
];

const decoder = new TextDecoder("utf-8");
const separate = chunks.map(chunk => decoder.decode(chunk));
console.log(JSON.stringify(separate), separate.join(""));

const streamed = chunks.map(chunk => decoder.decode(chunk, { stream: true }));
streamed.push(decoder.decode());
console.log(JSON.stringify(streamed), streamed.join(""));
```

两行输出分别是：

```text
["A�","�","�B"] A���B
["A","","茶B",""] A茶B
```

第一组里，每次 `decode(chunk)` 都把当前块当成一份完整输入。第一块读出 `A`，接着碰到 `E8`，直到输入结束都没等到续接字节。默认错误处理会输出替换字符 `�`（`U+FFFD`）。第二块的 `8C` 和第三块开头的 `B6` 都不能独自开始一个 UTF-8 字符，又各触发一次替换。最后拼接字符串时，那三个位置保存的已经是替换字符，原来的字节值无法从中取回。

## 空字符串也可能表示已经读进了字节

第二组的 `stream: true` 告诉解码器，当前块用尽后，后面还可能有数据。它可以立即交出完整字符，同时保留解到一半的状态。沿着“茶”字看三次调用：

| 到达的字节（十六进制） | 本次返回的字符串 | 调用结束时的状态 |
| --- | --- | --- |
| `41 E8` | `"A"` | 已读入“茶”的首字节，还需要两个续接字节 |
| `8C` | `""` | 已收到第一个续接字节，还差最后一个 |
| `B6 42` | `"茶B"` | “茶”和后续的 ASCII 字母都已输出 |

第二行最容易写错。读取循环如果碰到空字符串就退出，会在真正的“茶”字出来之前停下。循环应以字节来源给出的结束信号为准。同一份输入的所有块也要交给同一个解码器实例，前一块留下的状态才能在下一块继续使用。[WHATWG Encoding 标准中的 decode 算法](https://encoding.spec.whatwg.org/#dom-textdecoder-decode)

## 最后一次空调用能发现什么

正常读到文件末尾后，调用一次不带参数的 `decode()`，并接收它返回的字符串。在上面的完整文件中，这次调用返回空串。若文件恰好丢了“茶”的最后一个字节，结束信号就有了可观察的作用。下面的代码可以接在同一个示例之后运行。

```js
const tail = Uint8Array.of(0xe8, 0x8c);
for (const fatal of [false, true]) {
    const reader = new TextDecoder("utf-8", { fatal });
    console.log("收到尾块", JSON.stringify(reader.decode(tail, { stream: true })));
    try {
        console.log("文件结束", JSON.stringify(reader.decode()));
    } catch (error) {
        console.log("文件结束", error.name);
    }
}
```

收到尾块时，两种模式都返回 `""`，因为 `E8 8C` 仍有可能在下一块补全。到了文件结束，默认模式返回一个 `"�"`，严格模式（`fatal: true`）抛出 `TypeError`。如果把下一块换成 `42`，情况又不同：它显然不是续接字节，严格模式在读到这一块时就会报错，不必等到最后。流式解码只推迟尚不能判断的错误。[MDN 中文文档对参数与异常的说明](https://developer.mozilla.org/zh-CN/docs/Web/API/TextDecoder/decode)

对于按行导入的程序，还要分别保存两种进度。解码器保管未收齐的字符字节，分行程序保管已经解出、但还没遇到换行符的那半行。先让解码器处理完文件末尾，再把它最后返回的文本交给分行程序，才能正确处理没有末尾换行符的最后一条记录。
