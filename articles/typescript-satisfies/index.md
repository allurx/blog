---
title: "satisfies 为什么既能校验配置又保留具体类型"
date: 2026-09-27
updated: 2026-10-03
domain: "TypeScript"
tags: ["TypeScript","satisfies","类型推断"]
---

写配置时，常常希望同时做到两件事：拼错 `mode` 会报错，写下 `mode: "development"` 后，后续代码仍知道这个属性就是 `"development"`。

类型注解能检查对象是否符合 `AppConfig`，但会把变量的公开类型设为 `AppConfig`。`satisfies` 提供另一种选择：检查对象是否符合要求，再把检查过程中推断出的具体类型交给后续代码。下面用同一份配置比较这两种写法，并看 `as const` 会再改变什么。

`satisfies` 自 TypeScript 4.9 提供，以下声明输出以 TypeScript 7.0.2、`--strict` 为例。它参与编译期类型检查，运行时不会留下校验代码。

## 类型注解、satisfies 和断言各改变什么

TypeScript 4.9 引入 `satisfies`，官方定义是：验证表达式的类型与目标类型匹配，同时不改变该表达式最终得到的类型。官方示例正是用它同时捕获对象键名错误，并保留各属性的具体类型。[TypeScript 4.9 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)

三种写法可理解为：

| 写法 | 是否检查兼容性 | 变量后续采用的类型 |
| --- | --- | --- |
| `const x: T = value` | 是 | `T` |
| `const x = value satisfies T` | 是 | `value` 经正常推断与上下文类型化后的类型 |
| `const x = value as T` | 断言，不等同于契约检查 | `T` |

以配置中的 mode 为例，注解后的消费者看到的是 `"development" | "production"`，因此必须接受两种可能；满足检查后的对象则可以保留这次初始化得到的 `"development"`。是否需要这么窄的类型，取决于这个对象是固定配置，还是后面还要切换模式。

## 上下文类型化仍会影响推断

左侧表达式在目标类型提供的上下文中接受检查，所以 `satisfies` 也可能影响字面量、元组和回调参数的推断。检查通过后保留的是这次检查得到的表达式类型，而不是把变量的公开类型直接替换成右侧目标类型。

“保留”不等于“冻结”。普通对象属性仍按 TypeScript 的常规规则推断：字符串联合提供上下文时，`mode` 可以保留为 `"development"`；无须保留精确数值时，`retries: 3` 通常仍推断为 `number`。`as const` 会进一步把属性设为只读并保留更窄的字面量，因此两者组合时职责分别是：

- `as const` 控制左侧值的精确、只读推断；
- `satisfies AppConfig` 检查该精确类型是否符合契约。

这些都是编译期行为，生成的 JavaScript 不包含 `satisfies`。

## 生成声明文件比较三个配置对象

### 用相同值声明三个对象

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

### 观察消费者看到的声明

在已有 TypeScript 7.0.2 的项目中执行 `tsc --ignoreConfig config.ts --strict --declaration --emitDeclarationOnly --outDir types`。这里显式传入文件与编译参数，因此使用 7.0 的 `--ignoreConfig` 避免已有 `tsconfig.json` 触发 TS5112。本节在 Windows、TypeScript 7.0.2 下生成声明文件，包含以下导出（省略 `AppConfig`）：

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

### 拼错属性时，检查在哪里发生

把 `checked` 中的 `mode` 改成 `mod`，同次验证得到 TS2561，编译器拒绝这个新鲜对象字面量。对象先赋给其他变量再做兼容性检查时，不能据此假设所有额外属性都会被禁止，仍要区分结构兼容与额外属性检查。

## 什么时候保留窄类型更合适

路由表、主题配置和功能开关写在源码里时，`satisfies` 能同时检查配置形状，并保留每个属性的具体类型。若对象以后要从 development 切换到 production，或者端点数组需要修改，则应确认推断出的类型仍允许这些操作；`as const` 带来的只读元组可能恰好不符合需求。

函数对外接受的配置通常仍适合用稳定的 `AppConfig` 表达。一个具体对象是 development，不表示所有调用者都只能传 development。对象内部的精确信息与公开 API 允许的范围，可以各自承担职责。

如果配置来自 JSON 文件或网络响应，数据要等程序运行时才出现，此时仍需要解析和运行时校验。把 `satisfies AppConfig` 写在一个 `any` 值后面，无法替这些未知数据补上真实性保证。
