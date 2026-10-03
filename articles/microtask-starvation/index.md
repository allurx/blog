---
title: "微任务为什么会饿死定时器"
date: 2026-10-01
updated: 2026-10-03
domain: "JavaScript"
tags: ["EventLoop", "Microtask", "Performance"]
---

把一段长计算拆成许多 `queueMicrotask()` 回调，调用栈确实变短了，页面却仍然不能响应点击，已经到期的定时器也迟迟不执行。要解释这个现象，需要找到一个具体时刻：运行时什么时候能结束当前的微任务检查点，转去处理已经等待的任务。

把一次计算拆成小回调，只改变了每次调用有多长。如果下一次回调仍被追加到正在排空的微任务队列，定时器就还得继续等。下面先展开这个队列，再用相同计算比较微任务与任务级调度。

## 递归微任务为什么一直挡在定时器前面

### 新加入的微任务也在当前检查点执行

在浏览器中，执行一个任务后通常会进行微任务检查点。WHATWG HTML 规定，检查点会反复取出最早的微任务并执行，直到队列为空；执行过程中加入的新微任务同样会被处理。它不是在入口拍一张队列快照，只处理当时已有的回调。[HTML 微任务检查点](https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint)

例如，每个回调在结束前又安排一个回调：

```js
function next() {
  doOneUnit(); // 当前业务提供的一小段同步工作
  if (hasMore()) queueMicrotask(next);
}

queueMicrotask(next);
```

这是一段调度结构示意，`doOneUnit()` 和 `hasMore()` 由业务提供。即使每次工作很短，只要 `hasMore()` 始终为真，队列就不会排空。有限但很长的链也会把其他任务推迟到整条链结束。

### await 已完成的 Promise 仍会接回这条链

Promise 的回调与 `await` 后的续体也可能延长这条链。尤其是循环中的 `await Promise.resolve()`：它让当前函数暂停，再以微任务恢复，却没有让定时器任务插到检查点中间。等待真正尚未完成的 I/O 是另一回事，不能仅凭代码里出现了 `await` 判断响应性。[HTML 对 Promise job 的调度](https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuepromisejob)

### 到期的定时器需要等到有机会运行

`setTimeout(fn, 0)` 也不会抢占正在运行的 JavaScript。到期只满足了调度条件，不能强制当前栈或微任务检查点结束。浏览器还可能受嵌套计时器的最小延迟、后台节流等因素影响，因此 0 不是执行时限。[HTML 定时器](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers)

## 提供调度机会，不等于保证谁先执行

选择调度方式时，需要区分“延后当前回调”和“给其他任务机会”。

| 调度方式 | 延后到哪里 | 对长计算的意义 |
| --- | --- | --- |
| `queueMicrotask(fn)` | 微任务队列 | 递归安排会持续占用检查点 |
| `Promise.resolve().then(fn)` 或 `await Promise.resolve()` | Promise 续体 | 不能作为任务级让步 |
| 浏览器 `setTimeout(fn, 0)` | 后续定时器任务 | 允许离开当前检查点，但不保证立即执行、先处理某个输入或完成一次绘制 |
| Node.js `setImmediate(fn)` | 事件循环的 check 阶段 | 可用于分批工作，但不能保证某个定时器一定在下一批之前运行 |

Node.js 的 `setImmediate()` 在执行中的 immediate 回调内再次安排回调时，新的回调要等到后续事件循环迭代。因此，分批计算可以让事件循环继续前进。但它与 `setTimeout()` 的相对顺序取决于注册位置、当时的循环阶段和计时条件，不应写成“改用 immediate，定时器就一定先运行”。[Node.js timers 文档](https://nodejs.org/api/timers.html#setimmediatecallback-args)

## 在 Node.js 中比较相同批次的两种调度

### 观察定时器执行时，计算是否已经结束

下面的完整程序以 Node.js 24 LTS 为基线，无外部依赖，使用 ES module。保存为 `MicrotaskStarvationDemo.mjs`，执行 `node MicrotaskStarvationDemo.mjs`。两组都计算相同的整数和，也都每 1,000 项结束一个批次，唯一变化是安排下一批的方式。

程序观察定时器执行时工作是否已经全部完成，不用毫秒差异推导性能提升。

```js
import assert from 'node:assert/strict';

const total = 3_000_000;
const batchSize = 1_000;

function run(schedule) {
  return new Promise((resolve) => {
    let completed = 0;
    let sum = 0;
    let finished = false;
    let timerProgress;

    // 两个回调都完成后再报告，避免上一组计时器影响下一组。
    function report() {
      if (finished && timerProgress !== undefined) {
        resolve({ sum, timerSawAllWork: timerProgress === total });
      }
    }

    setTimeout(() => {
      timerProgress = completed;
      report();
    }, 0);

    function batch() {
      const end = Math.min(completed + batchSize, total);
      for (; completed < end; completed++) sum += completed;

      if (completed < total) {
        schedule(batch);
      } else {
        finished = true;
        report();
      }
    }

    schedule(batch);
  });
}

const microtask = await run(queueMicrotask);
const immediate = await run(setImmediate);
const expected = total * (total - 1) / 2;

assert.equal(microtask.sum, expected);
assert.equal(immediate.sum, expected);
assert.equal(microtask.timerSawAllWork, true);

console.log('microtask: timer saw all work =', microtask.timerSawAllWork);
console.log('immediate: timer saw all work =', immediate.timerSawAllWork);
console.log('both sums match =', microtask.sum === immediate.sum);
```

### 哪项结果由模型保证，哪项依赖调度

在 Windows、Node.js 24.19.0 下运行得到以下输出；其中 `immediate` 一行取决于实际调度与计时：

```text
microtask: timer saw all work = true
immediate: timer saw all work = false
both sums match = true
```

第一组的整个微任务链先执行完，定时器才能观察结果。第二组若输出 false，说明定时器在工作结束前获得了执行机会。代码只对第一组的顺序做断言，没有断言第二组必须在第几批插入定时器：批次数、机器速度和计时条件变化后，观察结果可能不同。该程序演示 Node.js 的调度顺序，不测量吞吐量或浏览器的输入、绘制响应。

### nextTick 为什么也不能用来让出长计算

`process.nextTick()` 使用独立队列，不能简单当作更快的任务级让步。递归向它补充回调同样可能阻止事件循环继续。Node.js 官方文档还特别区分 CommonJS 与 ES module 的顶层执行：ES module 本身通过异步流程求值，安排回调时已经处于微任务处理上下文，因而顺序会与 CommonJS 顶层不同。[Node.js：queueMicrotask 与 process.nextTick](https://nodejs.org/api/process.html#when-to-use-queuemicrotask-vs-processnexttick)

把下面同一段代码分别保存为 `order.cjs` 与 `order.mjs`，直接执行 `node order.cjs` 和 `node order.mjs`：

```js
const order = [];
process.nextTick(() => order.push('nextTick'));
queueMicrotask(() => order.push('microtask'));
setImmediate(() => console.log(order.join(' -> ')));
```

同一 Node.js 24.19.0 环境的实际输出分别为：

```text
nextTick -> microtask
microtask -> nextTick
```

这里的前提是直接运行入口文件中的顶层代码，不能把结果推广成所有回调嵌套场景的永久优先级。模块格式之外，还要看这些调用发生在普通回调中，还是已经位于正在排空的微任务队列中。对于需要跨环境使用的短异步通知，通常优先选择 `queueMicrotask()`；它适用的场景仍然不是长计算让步。

## 把响应性预算放到业务批次上

浏览器可把下一批工作放入 `setTimeout()` 回调；Node.js 可使用上例的 `setImmediate()`。批次太大，单次执行仍会阻塞；批次太小，又会增加调度开销。固定条数适合单项成本接近的工作，成本差异较大时可以用 `performance.now()` 按耗时结束批次，再根据目标环境的交互延迟调整预算。任何预算都无法中断一项已经开始的同步操作。

取消和异常也应在这个边界表达清楚：开始下一批前检查取消状态，出错后停止追加工作并向调用方传播失败，而不是让递归调度无限持续。若一项计算本身就很重，应考虑浏览器 Web Worker 或 Node.js Worker Threads；主线程分批只能让出机会，不会把计算自动移到别的线程。

回到开篇不能点击的页面：如果下一批仍由微任务追加，拆得再细也可能让输入任务一直等待；如果每批结束后回到任务调度，浏览器才有机会处理其他工作。最后还要控制每批的实际耗时，因为调度器无法中断已经开始的一段同步计算。
