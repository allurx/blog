---
title: "JavaScript 字符串的 length 为什么不是字符数"
date: "2026-10-05"
domain: "JavaScript"
tags: ["JavaScript", "Unicode", "UTF-16", "Intl.Segmenter"]
---

在输入框里键入一个 `😀`，JavaScript 却给出 `"😀".length === 2`。换成由多个家庭成员组成的 `👨‍👩‍👧‍👦`，结果是 11；用户看到的仍是一个整体。这里没有编码错误，只是“字符”这个日常说法把几种不同的计数单位混在了一起。

本文从 UTF-16 码元、Unicode 码点讲到扩展字素簇，说明各类 JavaScript API 实际在数什么，以及怎样按用户看到的文本单元截取字符串。示例以 Node.js 24.19.0、ICU 78.3 和 Unicode 17.0 数据运行；需要了解字符串、数组迭代和基本的 Unicode 编码概念。

## length 数的是 UTF-16 码元

ECMAScript 把字符串定义为一串 16 位无符号整数。每个整数是一个 UTF-16 **码元**（code unit），`length` 返回的正是码元数量；下标访问、`slice()` 和许多位置参数也使用码元偏移量。[ECMAScript 2026 的 String 类型](https://tc39.es/ecma262/2026/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-string-type)

基本多文种平面（BMP）内的大多数码点可以放进一个码元，例如 `A` 是 `U+0041`。BMP 之外的码点需要一对代理码元表示：`😀` 是码点 `U+1F600`，UTF-16 编码为 `D83D DE00`，所以它的 `length` 是 2。

```js
"A".length; // 1
"😀".length; // 2
"😀"[0]; // "\uD83D"，只是高代理码元
"😀".slice(0, 1); // "\uD83D"，得到不完整的 UTF-16
```

这也是按 `length` 截断文本的第一类风险：边界可能落在代理对中间。ECMAScript 字符串甚至允许保存这种不成对的代理码元，因此运行时不会替应用自动修复截断结果。

## 字符串迭代器前进一个码点

字符串的迭代协议比下标更理解 UTF-16。`for...of`、展开语法和 `Array.from()` 会把有效代理对合成一个 Unicode **码点**（code point），所以 `[..."😀"].length` 是 1。对孤立代理码元，它们仍会单独产生一个值。[ECMAScript 2026 的字符串迭代器](https://tc39.es/ecma262/2026/multipage/text-processing.html#sec-string-iterator-objects)

码点计数解决了单个补充平面字符的问题，却还没有到达用户看到的文本单元。下面几个序列都可能显示为一个整体：

- `e\u0301` 由拉丁字母 `e` 和组合尖音符两个码点组成，通常显示为 `é`；
- `🇨🇳` 由两个区域指示符码点组成；
- `👨‍👩‍👧‍👦` 由四个 emoji 和三个零宽连接符（ZWJ）组成。

因此，码元、码点和屏幕上的“一个字符”是三层不同的问题。展开字符串只能保证不拆开有效代理对，仍会把组合附加符、旗帜和 ZWJ 序列拆散。

## 字素簇给出可编程的用户感知边界

Unicode 使用**扩展字素簇**（extended grapheme cluster）近似用户感知的字符。它不是简单地找连接符，而是按字符属性和一组有顺序的边界规则处理组合标记、Hangul、区域指示符、emoji ZWJ 序列等情况。Unicode 17.0 的 [UAX #29 文本分段规范](https://www.unicode.org/reports/tr29/tr29-47.html#Grapheme_Cluster_Boundaries)给出了默认规则，并说明字素簇适合用于光标移动、删除和面向用户的字符计数。

ECMA-402 的 `Intl.Segmenter` 把这类分段能力暴露给 JavaScript。把 `granularity` 设为 `"grapheme"`，迭代 `segment()` 的结果即可取得每个字素簇：

```js
const segmenter = new Intl.Segmenter("zh-CN", {
    granularity: "grapheme",
});

const clusters = [...segmenter.segment("A👨‍👩‍👧‍👦e\u0301🇨🇳")];
console.log(clusters.map(({ segment }) => segment));
// [ "A", "👨‍👩‍👧‍👦", "é", "🇨🇳" ]
```

这里的区域设置是明确的应用配置。ECMA-402 规定 `Intl.Segmenter` 支持 `"grapheme"`、`"word"` 和 `"sentence"` 三种粒度，具体可用区域设置和分段数据由实现提供。[ECMAScript Internationalization API 的 Segmenter 定义](https://tc39.es/ecma402/#segmenter-objects)

完整的[可执行示例](./grapheme-demo.mjs)同时统计五组输入。本文环境的实际输出如下：

```text
name        units points graphemes value
ASCII           1      1         1 A
emoji           2      1         1 😀
decomposed      2      2         1 é
family         11      7         1 👨‍👩‍👧‍👦
flag            4      2         1 🇨🇳
first 3 graphemes: A👨‍👩‍👧‍👦é
```

表中三列分别回答不同问题：码元数对应 JavaScript 的存储模型和大多数字符串索引；码点数对应 Unicode 编码元素；字素簇数才更接近界面中的选择、删除和长度限制。

## 截取时保留原字符串的码元位置

`segment()` 返回的每项不只有 `segment`，还有原字符串中的 `index`。这个索引仍是 UTF-16 码元偏移量，因而能直接交给 `slice()`。例如要保留前 `limit` 个字素簇，可以在第 `limit + 1` 个分段开始的位置截断：

```js
function sliceGraphemes(text, limit, locale = "zh-CN") {
    if (!Number.isInteger(limit) || limit < 0) {
        throw new RangeError("limit must be a non-negative integer");
    }

    const segments = new Intl.Segmenter(locale, {
        granularity: "grapheme",
    }).segment(text);
    let count = 0;

    for (const { index } of segments) {
        if (count === limit) return text.slice(0, index);
        count += 1;
    }
    return text;
}
```

这个实现不会先把整段文本复制成数组，找到边界后就停止。不过，每次调用都构造分段器会增加开销；固定区域设置的应用可以复用 `Intl.Segmenter` 实例。若目标运行时不提供该 API，应引入明确实现 Unicode 字素边界的库，不能退回 `[...text]` 并把码点冒充为字素簇。

## 计数单位要由业务目标决定

字素簇适合界面中的字符上限，却不是所有限制的统一答案：

- 数据库列、消息协议或存储配额若限制 UTF-8 字节数，应在实际编码后计算字节，而不是数字素簇；
- 加密、哈希和网络签名处理确定的字节序列，不能先按视觉字符折叠；
- 规范化会把某些规范等价序列转换成 NFC 或 NFD，但不会把所有多码点字素簇变成单个码点，家庭 emoji 就没有这种单码点形式；
- 字素簇是基于文本数据的默认近似，不等同于字形。字体可能把两个字素簇显示成一个连字，也可能为一个字素簇绘制多个字形；精确光标位置还要依赖排版引擎；
- Unicode 和 ICU 数据会演进。跨服务保存“第几个字符”或要求永久复现边界时，需要固定并记录分段实现和 Unicode 数据版本，或直接保存已确认的码元边界。

所以，`length` 并没有给出错误答案；它准确回答了“这个 ECMAScript 字符串包含多少个 16 位码元”。应用出错通常是因为问题实际在问“用户看到了多少个可编辑文本单元”。先明确需要码元、码点、字素簇还是编码后的字节，再选择相应 API，字符串长度和截断的边界才会一致。
