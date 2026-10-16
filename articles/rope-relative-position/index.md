---
title: "RoPE 为什么旋转绝对位置，却让注意力看到相对距离"
date: 2026-10-16
domain: 大模型
tags: [RoPE, Transformer, Attention, Position Encoding]
---

Transformer 的注意力会比较 Query 与 Key 的点积，但单独的点积不知道两个 token 谁在前、谁在后，也不知道它们相隔多远。Rotary Position Embedding（RoPE）给出的做法看起来有些矛盾：它先用每个 token 的**绝对位置**旋转 Query 和 Key，旋转后的点积却能以**相对位置差**表示。

本文从二维旋转开始推导这个结果，再扩展到多维注意力向量，并说明实现时的旋转维度、KV cache 和长上下文边界。只需了解向量点积、正弦和余弦；示例使用 Node.js 24.21.0，仅验证几何性质，不实现完整 Transformer。

## 没有位置信息的点积只比较内容

Scaled Dot-Product Attention 先为位置 $m$ 的 Query 与位置 $n$ 的 Key 计算分数：

$$
s_{m,n}=\frac{q_m^\mathsf{T}k_n}{\sqrt{d_k}}
$$

随后对同一 Query 的所有分数应用 softmax，再用所得权重汇总 Value。[《Attention Is All You Need》](https://arxiv.org/abs/1706.03762)给出了这条注意力主线。若 $q_m$ 和 $k_n$ 只由 token 内容产生，那么交换两个内容相同的 token 不会仅因位置变化而改变点积，模型需要另外获得顺序信息。

一种直观方法是给 token 表示加上位置向量。RoPE 采用不同的入口：不把位置向量相加，而是在点积发生前旋转 Query 与 Key。Value 通常不参与这一步，因为位置要改变的是“当前 Query 应该怎样给各个 Key 打分”，不是把相位直接写进最终汇总的内容。

## 二维旋转把位置写进相位

先只看 Query 和 Key 的两个分量。位置 $m$ 对应角度 $m\theta$，旋转矩阵为：

$$
R(m\theta)=
\begin{bmatrix}
\cos(m\theta) & -\sin(m\theta) \\
\sin(m\theta) & \cos(m\theta)
\end{bmatrix}
$$

RoPE 分别把内容向量旋转到各自位置：

$$
\widetilde{q}_m=R(m\theta)q_m,\qquad
\widetilde{k}_n=R(n\theta)k_n
$$

旋转不会改变向量长度，只改变方向。位置因此表现为相位，而不是额外增大或减小某个分量。真正关键的是两个旋转后向量的点积：

$$
\begin{aligned}
\widetilde{q}_m^\mathsf{T}\widetilde{k}_n
&=(R(m\theta)q_m)^\mathsf{T}R(n\theta)k_n \\
&=q_m^\mathsf{T}R(m\theta)^\mathsf{T}R(n\theta)k_n \\
&=q_m^\mathsf{T}R((n-m)\theta)k_n
\end{aligned}
$$

二维旋转矩阵是正交矩阵，转置等于反向旋转；先反向旋转 $m\theta$，再正向旋转 $n\theta$，合成结果就是旋转 $(n-m)\theta$。绝对位置 $m$ 和 $n$ 因而在点积里合并成了差值 $n-m$。

这项结论需要准确表述：**RoPE 引入的位置信号只依赖相对位置，不代表整个注意力分数只由距离决定。** $q_m$ 与 $k_n$ 仍包含 token 和上下文信息。只有固定内容向量，同时把两个位置平移相同距离时，旋转后的点积才保持不变。

## 多个二维平面同时表达不同尺度

真实注意力头的维度远大于 2。RoPE 把参与旋转的偶数维向量两两分组，每一对在独立二维平面中使用自己的频率：

$$
\theta_i=10000^{-2i/d},\qquad i=0,1,\ldots,d/2-1
$$

高频平面的相位随位置快速变化，低频平面变化更慢。把各对分量的旋转矩阵沿对角线组合起来，就得到高维的块对角旋转矩阵。每个二维块都满足 $R_m^\mathsf{T}R_n=R_{n-m}$，所以完整点积仍保留相对位置性质。

也可以把每对实数分量看成一个复数。位置 $m$ 的旋转相当于乘以 $e^{\mathrm{i}m\theta_i}$；Query 与 Key 做带共轭的内积时，相位相除，留下 $e^{\mathrm{i}(n-m)\theta_i}$。复数写法更紧凑，实现通常仍会把它展开成成对的 `cos`、`sin`、乘法和加法。

[RoFormer 原论文](https://arxiv.org/abs/2104.09864)从满足相对位置点积条件的二维形式出发提出 RoPE，并将它扩展到高维。[作者公开实现](https://github.com/ZhuiyiTechnology/roformer)也将核心思路概括为：按绝对位置旋转 Query、Key，使二者内积依赖相对位置。

## 用同移不变性验证推导

同目录的[完整 Node.js 示例](./rope-demo.mjs)实现四维 RoPE。它固定 Query 和 Key 内容，比较位置 `(2, 7)` 与整体右移 100 后的 `(102, 107)`，再比较距离不同的 `(2, 8)`：

```sh
node rope-demo.mjs
```

在 Node.js 24.21.0 上输出：

```text
score(2, 7)=-1.123050298416
score(102, 107)=-1.123050298416
score(2, 8)=-1.225545938472
same-relative-offset=true
different-offset-changes-score=true
query-norm-preserved=true
key-norm-preserved=true
```

前两项的相对位置都是 5，因此在浮点误差范围内相等；第三项的相对位置变成 6，分数随之改变。最后两项验证旋转保持范数。示例没有除以 $\sqrt{d_k}$，因为同一个常数不会改变要验证的等式。

## 实现必须让位置编号和缓存保持一致

公式简洁，工程实现仍有几个容易错位的条件：

- **旋转维度必须成对。** 有些模型旋转每个注意力头的全部维度，有些只旋转前面的偶数维子空间；剩余分量保持原样。两种做法都可以，但模型配置、权重和推理实现必须一致。
- **Query 与 Key 必须使用相同频率。** 两边的 `base`、频率排列、分组方式或缩放策略不同，$R_m^\mathsf{T}R_n=R_{n-m}$ 的对应关系就会被破坏。
- **KV cache 要保留正确的绝对位置。** 自回归推理通常在 Key 写入 cache 前完成旋转，新 token 的 Query 再按当前绝对位置旋转。读取缓存时无需重新旋转全部历史 Key，但 padding、分块预填充、滑动窗口和批处理不能让 `position_ids` 偏移。
- **张量布局决定配对方式。** “相邻两维配成一对”和“前后两半交错配对”可以表示等价旋转，却不能直接混用；加载既有权重时必须遵循该模型训练时的布局。

这些条件说明 RoPE 不是可以随意插入任意层的后处理。它属于注意力分数的坐标约定，训练与推理的每一条路径都要采用同一约定。

## 能计算更远位置不等于能无损外推

RoPE 不需要为每个位置保存一行可学习 embedding，给定位置编号即可计算旋转角度，因此形式上可以处理训练长度之外的位置。这个“可以计算”不能直接推出模型在任意更长上下文上仍然可靠。

每个二维频率都是周期性的，位置变远后会进入训练阶段未充分覆盖的相位组合；注意力头、数据分布和其他网络层也都只在有限长度上共同优化。调整 RoPE 的 base、对位置做插值或采用其他缩放策略，会改变不同频率看到的距离，必须结合具体模型的训练方式和目标长度验证，不能只改一个推理参数就假定语义完全保留。

RoPE 的核心价值是一条清楚的几何恒等式：绝对位置控制每个 Query、Key 的旋转，相对位置差控制两次旋转在点积中的合成结果。多频率二维旋转让不同尺度的距离同时参与注意力，又不改变向量范数。理解这条主线后，KV cache 的位置偏移、配对布局不一致和长上下文缩放为何会影响结果，也就不再只是实现细节。
