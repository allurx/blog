---
title: "satisfies 为什么既能校验配置又保留具体类型"
date: 2026-09-27
updated: 2026-10-02
domain: "TypeScript"
tags: ["TypeScript","satisfies","类型推断"]
---

配置对象既要符合 `AppConfig`，又希望后续代码知道 `mode` 确实是 `"development"`。直接加类型注解会把变量的公开类型设为 `AppConfig`；直接 `as AppConfig` 又不是同样的契约检查。`satisfies` 把这两个目标分开：检查赋值兼容性，同时保留表达式经推断和上下文类型化得到的类型。

这个“保留”有边界。它不会自动冻结对象或保留每个数字字面量，更不会在运行时校验 JSON。需要精确字面量与只读属性时，再组合 `as const`。该运算符自 TypeScript 4.9 提供，以下声明输出以 TypeScript 7.0.2、`--strict` 为例。

## 类型注解、satisfies 和断言各改变什么

TypeScript 4.9 引入 `satisfies`，官方定义是：验证表达式的类型与目标类型匹配，同时不改变该表达式最终得到的类型。官方示例正是用它同时捕获对象键名错误，并保留各属性的具体类型。[TypeScript 4.9 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)

三种写法可理解为：

| 写法 | 是否检查兼容性 | 变量后续采用的类型 |
| --- | --- | --- |
| `const x: T = value` | 是 | `T` |
| `const x = value satisfies T` | 是 | `value` 经正常推断与上下文类型化后的类型 |
| `const x = value as T` | 断言，不等同于契约检查 | `T` |

因此，`satisfies` 不是“更短的类型注解”，而是“约束检查”和“结果类型”分离的运算符。

## 上下文类型化仍会影响推断

左侧表达式在目标类型提供的上下文中接受检查，所以 `satisfies` 也可能影响字面量、元组和回调参数的推断。检查通过后保留的是这次检查得到的表达式类型，而不是把变量的公开类型直接替换成右侧目标类型。

“保留”不等于“冻结”。普通对象属性仍按 TypeScript 的常规规则推断：字符串联合提供上下文时，`mode` 可以保留为 `"development"`；无须保留精确数值时，`retries: 3` 通常仍推断为 `number`。`as const` 会进一步把属性设为只读并保留更窄的字面量，因此两者组合时职责分别是：

- `as const` 控制左侧值的精确、只读推断；
- `satisfies AppConfig` 检查该精确类型是否符合契约。

这些都是编译期行为，生成的 JavaScript 不包含 `satisfies`。

## 生成声明文件比较三个配置对象

将下面代码保存为 `config.ts`。导出配置是为了从声明文件观察模块消费者看到的类型：

```ts
export type AppConfig = {
  mode: "development" | "production";
  retries: number;
  endpoints: readonly string[];
};

export const annotated: AppConfig = {
  mode: "development",
  retries: 3,
  endpoints: ["/api"],
};

export const checked = {
  mode: "development",
  retries: 3,
  endpoints: ["/api"],
} satisfies AppConfig;

export const frozen = {
  mode: "development",
  retries: 3,
  endpoints: ["/api"],
} as const satisfies AppConfig;
```

在已有 TypeScript 7.0.2 的项目中执行 `tsc --ignoreConfig config.ts --strict --declaration --emitDeclarationOnly --outDir types`。这里显式传入文件与编译参数，因此使用 7.0 的 `--ignoreConfig` 避免已有 `tsconfig.json` 触发 TS5112。该命令生成的声明文件包含以下导出（省略 `AppConfig`）：

```ts
export declare const annotated: AppConfig;

export declare const checked: {
  mode: "development";
  retries: number;
  endpoints: string[];
};

export declare const frozen: {
  readonly mode: "development";
  readonly retries: 3;
  readonly endpoints: readonly ["/api"];
};
```

把 `checked` 中的 `mode` 改成 `mod`，同次验证得到 TS2561，编译器拒绝这个新鲜对象字面量。对象先赋给其他变量再做兼容性检查时，不能据此假设所有额外属性都会被禁止，仍要区分结构兼容与额外属性检查。

## 在代码内配置和外部输入之间划清边界

- 对路由表、功能开关、主题配置等“代码内常量”，优先考虑 `satisfies`：既检查键和值，又保留具体属性供后续推断。
- 只有确实需要深层只读和精确字面量时才组合 `as const`，否则可能让数组成为只读元组，给后续修改带来额外约束。
- 对函数参数和模块边界，仍应显式使用稳定的公开类型；不要依赖某个对象偶然推断出的过窄结构作为长期 API。
- `JSON.parse()`、网络响应和用户输入必须使用运行时校验器或手写解析逻辑；`satisfies` 不能验证运行时数据。
