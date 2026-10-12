---
title: 为什么 sRGB 颜色不能直接按通道平均
date: 2026-10-12
domain: 图形与多媒体
tags: [sRGB, Linear Light, Color Mixing, Gamma]
---

把黑色 `#000000` 和白色 `#ffffff` 各取一半，最直接的算法会逐通道计算 `(0 + 255) / 2`，得到 `#808080`。这个结果在数值上位于两端正中，却只对应大约 21.6% 的线性光强；真正取一半光强再编码回 sRGB，结果接近 `#bcbcbc`。

差异来自一个容易忽略的前提：sRGB 通道值是为了存储和传输而编码的信号，不是与光强成正比的测量值。本文从 sRGB 的传递函数推导两种混合结果，给出可执行实现，并说明线性光、sRGB 与感知均匀颜色空间分别适合解决什么问题。理解公式只需要知道 RGB 每个通道通常用 `0` 到 `255` 表示。

## sRGB 用非线性编码分配数值

显示和图像处理中的“线性”是指数值加倍时，表示的光能也加倍。sRGB 没有直接保存这种线性值。它在接近黑色的位置分配更多编码级别，让有限位数更有效地覆盖人眼敏感的暗部变化。

[CSS Color 4 定义的 sRGB 解码函数](https://www.w3.org/TR/2026/CRD-css-color-4-20261007/#color-conversion-code)先把 8 位通道归一化到 $C_s \in [0, 1]$，再还原线性通道 $C_l$：

$$
C_l =
\begin{cases}
\dfrac{C_s}{12.92}, & C_s \le 0.04045 \\
\left(\dfrac{C_s + 0.055}{1.055}\right)^{2.4}, & C_s > 0.04045
\end{cases}
$$

因此，归一化编码值 `0.5` 解码后不是线性光的 `0.5`，而是约 `0.214`。实际 8 位中点 `128 / 255` 解码后约为 `0.215861`。sRGB 常被口语化描述为“gamma 2.2”，但标准函数包含靠近零点的线性段和指数为 `2.4` 的非线性段；用简单的 $C^{2.2}$ 替代会产生不同结果。

从线性值重新编码为 sRGB 时使用逆函数：

$$
C_s =
\begin{cases}
12.92C_l, & C_l \le 0.0031308 \\
1.055C_l^{1/2.4} - 0.055, & C_l > 0.0031308
\end{cases}
$$

[CSS Color 4 对 `srgb-linear` 的定义](https://www.w3.org/TR/2026/CRD-css-color-4-20261007/#color-conversion-code)正是与 sRGB 使用相同的三原色和白点，但不施加这种非线性编码。两者描述相同的色域，通道数值的含义却不同。

## 先解码，再混合，最后重新编码

若目标是按光能比例混合两个颜色，权重为 $t$ 的单个通道应按下面的顺序计算：

$$
C_l = (1-t)\operatorname{decode}(A_s) + t\operatorname{decode}(B_s),
$$

$$
C_s = \operatorname{encode}(C_l).
$$

直接在 sRGB 编码值上计算 $(1-t)A_s+tB_s$，省略了解码与重新编码。对端点差异大的颜色，这个误差非常明显：

| 输入与权重 | 直接混合 sRGB 编码值 | 在线性光中混合 |
| --- | --- | --- |
| 黑色与白色，各 50% | `#808080` | `#bcbcbc` |
| 红色与绿色，各 50% | `#808000` | `#bcbc00` |

黑白示例中的线性光目标是 `0.5`。编码函数得到约 `0.735357`，乘以 `255` 后舍入为 `188`，也就是十六进制 `bc`。`#bcbcbc` 看起来比 `#808080` 亮很多，因为后者保存的并不是一半光强。

这不意味着 `#bcbcbc` 一定是“视觉上正好位于黑白之间”的灰色。线性光混合保持的是光能比例；人的明度感知仍然非线性。物理量的中点和感知上的中点是两个不同目标。

## 用 Node.js 复现两个中点

同目录的[完整示例](./srgb-mixing.mjs)只使用 JavaScript 标准库，实现标准传递函数，并断言两组混合结果。使用 Node.js 24.21.0 运行：

```sh
node srgb-mixing.mjs
```

输出为：

```text
black-white-srgb=#808080
black-white-linear=#bcbcbc
srgb-midpoint-linear-light=0.215861
linear-light-target=0.500000
red-green-srgb=#808000
red-green-linear=#bcbc00
```

核心差异可以压缩为两个函数。`mixSrgb` 直接插值编码值；`mixLinearLight` 在插值前后完成转换：

```js
function mixSrgb(a, b, t) {
    return a.map((channel, index) => channel * (1 - t) + b[index] * t);
}

function mixLinearLight(a, b, t) {
    return a.map((channel, index) => {
        const linear = decodeSrgb(channel) * (1 - t) + decodeSrgb(b[index]) * t;
        return encodeSrgb(linear);
    });
}
```

示例内部使用 `0` 到 `1` 的浮点通道，直到生成十六进制文本时才量化为 8 位。若每一步都先舍入为整数，多次滤波或渐变会累积额外的量化误差。实际图像管线通常应在足够精度的线性缓冲区中完成一系列运算，最后输出时再编码和量化。

## 颜色空间由混合目标决定

“正确混合”需要先说明要保持什么性质。线性光适合光能应当线性叠加的计算，例如图像缩放与重采样、模糊、照明计算，以及要求物理一致性的合成过程。[CSS Color 4 也把线性光颜色空间描述为适合需要与光强成线性关系的计算](https://www.w3.org/TR/2026/CRD-css-color-4-20261007/#interpolation-space)。

界面渐变和配色工具未必追求物理光能。直接在 sRGB 中插值能复现许多既有软件的行为，但深色区域往往比线性光结果更暗。若目标是让色相、彩度和明度的变化在视觉上更均匀，可以选择 Oklab 等感知导向的空间。感知均匀与线性光同样不是一回事：前者尽量让数值距离对应视觉差异，后者让数值对应光强。

[CSS Color 5 的 `color-mix()`](https://www.w3.org/TR/2026/WD-css-color-5-20260618/#color-mix)要求显式或默认选择插值空间。下面三条声明使用同一组端点，却分别表达传统 sRGB 数值混合、线性光混合和感知导向混合：

```css
.encoded { color: color-mix(in srgb, black 50%, white); }
.light   { color: color-mix(in srgb-linear, black 50%, white); }
.visual  { color: color-mix(in oklab, black 50%, white); }
```

该草案当前把 Oklab 作为省略插值方法时的默认空间。对需要稳定复现的设计系统，仍应写出空间名称，避免把结果依赖于读者不知道的默认值。使用草案功能时还应在目标浏览器版本中验证语法和渲染支持。

## Alpha 不能跟着 RGB 一起解码

透明度 `alpha` 表示覆盖或不透明比例，不使用 sRGB 传递函数。处理带透明度的颜色时，只解码 RGB 通道，不能对 alpha 做 gamma 转换。[PNG 规范对 alpha 的定义](https://www.w3.org/TR/png-3/#11alpha)同样指出，alpha 与 RGB 样本是否采用非线性编码无关，它本身是线性的。

插值透明颜色还要考虑预乘 alpha。若直接对未预乘的 RGBA 通道插值，一个几乎透明像素中不可见的 RGB 值可能渗入边缘，形成色边。常见的处理顺序是：将 RGB 变为目标计算空间，以 alpha 预乘 RGB，插值或合成，再解除预乘；需要输出 sRGB 时，最后才重新编码 RGB。[Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/#simplealphacompositing)给出了基于预乘颜色的源覆盖合成公式。

具体 API 可能规定自己的工作空间、预乘时机和精度，调用者应以其契约为准。只把某段代码中的 `lerp(rgbaA, rgbaB, t)` 改名为“线性混合”，并不能自动满足这些条件。

## 色域和 HDR 仍需要独立处理

线性化只修正传递函数，不会扩大 sRGB 色域，也不会自动处理超出范围的通道。Display P3 等广色域颜色需要先转换到选定的共同空间；转换后超出目标色域时，还要决定裁剪或色域映射策略。HDR 格式可能使用 PQ、HLG 或其他传递函数，不能套用 sRGB 的分段公式。

同样，RGB 线性通道的加权和也不等于完整的“亮度”计算。亮度还涉及各三原色对标准观察者的不同贡献；仅比较某个通道或三个通道的算术平均，不能替代颜色空间定义的相对亮度公式。

判断颜色混合算法时，可以先问清结果要保持光能、既有数值行为，还是视觉上的均匀变化。需要光能线性时，流程很明确：把 sRGB 解码到线性光，在足够精度下完成计算，再编码到输出格式。这个步骤解释了 `#808080` 与 `#bcbcbc` 的差异，也适用于比两个颜色取平均更广泛的滤波、缩放和合成问题。
