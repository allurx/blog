---
title: "import type 为什么不只是代码风格"
date: "2026-09-05"
updated: 2026-10-03
domain: "TypeScript"
tags: ["TypeScript", "ESModules", "类型系统"]
---

一个模块在顶层注册自定义元素，另一个模块从它导入配置类型。把这条导入改成 `import type` 后，类型检查通过了，页面里的自定义元素却可能不再注册。

原因藏在编译输出里：类型导入会被擦除，原本伴随模块加载发生的初始化也可能消失。下面把类型需要、运行时值和模块副作用分开，再实际比较三种导入形式生成的 JavaScript。

本文以 TypeScript 7.0.2 为编译器基线，解释自 5.0 引入的 `verbatimModuleSyntax`：整个类型导入声明、混合导入中的 `type` 修饰符和显式副作用导入分别会留下什么。读者需了解 ESM 的导入与导出。构建工具可能进一步做 tree shaking，以下先隔离 TypeScript 自身的输出，再用 Node.js 24 LTS 观察模块求值。

## 先判断代码到底需要导入什么

编译器需要的信息与运行中的 JavaScript 需要的信息并不完全相同。`interface`、类型别名和泛型参数用于检查代码；变量、函数、对象和 class 构造器则真实存在于运行时。TypeScript 分别称它们所在的范围为类型空间（type space）和值空间（value space）。

### interface 只参与类型检查

`interface` 只存在于 Type space：

```typescript
export interface Book {
  readonly id: number;
}
```

因此以下导入只能用于类型位置：

```typescript
import type { Book } from "./book.js";
```

### class 还提供运行时构造器

class 同时存在于两个空间：

```typescript
export class Book {}
```

`Book` 既可以表示实例类型，也可以表示运行时构造器。导入方式取决于具体用途，而不是它在源文件中是否被声明为 class。

使用 `new Book()`、`extends Book`、`Book.someStaticMethod()` 或 `instanceof Book` 时，需要运行时构造器，必须保留普通导入。若 `Book` 只出现在参数或返回值类型中，则可以使用 `import type`。[TypeScript：类型导入与导出](https://www.typescriptlang.org/docs/handbook/modules/reference.html#type-only-imports-and-exports)

## verbatimModuleSyntax 如何决定输出

开启以下选项后，导入是否保留主要由源文件中的声明形式表达：

```json
{
  "compilerOptions": {
    "verbatimModuleSyntax": true
  }
}
```

### 整条类型导入会消失

整个类型导入会被删除：

```typescript
import type { Book } from "./book.js";

export function read(book: Book): void {
  console.log(book);
}
```

对应 JavaScript 不再引用 `book.js`：

```javascript
export function read(book) {
  console.log(book);
}
```

### 混合导入只移除类型项

如果同一模块同时提供值和类型，可以逐项标记：

```typescript
import { createBook, type Book } from "./book.js";
```

输出会保留 `createBook`：

```javascript
import { createBook } from "./book.js";
```

### 所有导入项都带 type，仍可能加载模块

前面的规则逐项删除类型导入。如果一条普通导入恰好只包含类型项，会发生什么？

```typescript
import { type Book } from "./book.js";
```

在 `verbatimModuleSyntax` 下，这种写法会留下：

```javascript
import {} from "./book.js";
```

ESM 仍会加载并求值 `book.js`。如果目的是明确不建立该运行时依赖，应使用整条 `import type { Book }`；不能仅因所有导入项都带 `type`，就认定目标模块不会执行。[verbatimModuleSyntax 的输出示例](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html)

另一个边界是纯类型导出：`Book` 若是 `interface`，启用该选项后用普通 `import { Book }` 导入，会收到应使用类型导入的诊断；不能笼统地说两种写法都能通过类型检查。若它是 class，则普通导入合法，即使使用方只在类型位置使用，导入仍会保留。

## 把副作用单独写清楚

假设模块负责注册自定义元素。原代码偶然通过一个普通导入触发了注册，改成 `import type` 后，注册不会再发生。应把两个需求分开表达：

```typescript
import "./register-elements.js";
import type { ReaderConfig } from "./reader.js";
import { createReader } from "./reader.js";
```

第一行要求执行模块，第二行只约束类型，第三行需要运行时值。这样更换编译器或调整类型使用时，不会顺带改变注册入口。打包阶段还需让 `sideEffects` 等配置准确反映模块行为，不能用错误的打包声明抵消显式副作用导入。

`import type` 可以消除对应的运行时模块依赖边，但不会消除类型之间的引用，也不会使算法本身更快。它的主要价值是让模块关系可检查、可预测。

## 编译并观察三种导入的模块求值

### 编译三个独立入口

将 [book.mts](./book.mts)、[type-only.mts](./type-only.mts)、[inline-type.mts](./inline-type.mts) 和 [mixed.mts](./mixed.mts) 下载到同一目录。`book.mts` 同时导出类型和工厂函数，并在模块顶层打印 `book module evaluated`；另外三个入口分别采用前文的三种导入形式。`.mts` 会生成 `.mjs`，因此 Node.js 可以明确按 ESM 执行，不依赖其他项目的 `package.json`。

在 TypeScript 7.0.2 环境中编译：

```sh
tsc --ignoreConfig book.mts type-only.mts inline-type.mts mixed.mts --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --verbatimModuleSyntax --outDir out
```

然后使用 Node.js 24 LTS 分别启动三个入口，每次都是独立进程，避免模块缓存影响观察：

```sh
node out/type-only.mjs
node out/inline-type.mjs
node out/mixed.mjs
```

### 从顶层输出判断是否求值

在 Windows、TypeScript 7.0.2、Node.js 24.19.0 下运行，第一条没有输出，第二条和第三条各输出一次 `book module evaluated`。检查生成文件也能看到：第一条类型导入已消失，第二条保留空导入，第三条保留 `createBook`。这里验证的是模块是否执行，不是打包体积或性能提升。

## 配置要匹配实际模块宿主

对由 Vite 等打包器处理的 ESM 工程，以下是常见的配置组合：

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```

`moduleResolution: "bundler"` 适合打包器的解析行为，并非直接由 Node.js 执行的所有项目都适用。Node 项目还需让 `module`、文件扩展名和 `package.json` 的 `type` 对齐实际 ESM 或 CommonJS 环境。

启用 `verbatimModuleSyntax` 后，TypeScript 不会为了 CommonJS 输出把 ES import 自动改写成 `require`，而是提示模块格式冲突。处理这种错误时，应先确认目标运行方式；不要为了让编译通过，随意切换整个项目的模块体系。

修改导入时可以从实际用途出发：只提供类型约束的使用点采用类型导入，需要调用或构造的值保留普通导入，顶层初始化则写显式副作用导入。然后检查编译输出，并在存在注册或初始化逻辑时验证实际启动行为。
