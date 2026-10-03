---
title: "微任务为什么会饿死定时器"
date: 2026-10-01
updated: 2026-10-03
domain: "JavaScript"
tags: ["EventLoop", "Microtask", "Performance"]
---

把一段长计算拆成许多 `queueMicrotask()` 回调，调用栈确实变短了，页面却仍然不能响应点击，已经到期的定时器也迟迟不执行。问题不在于代码有没有“异步”，而在于它有没有让运行时结束当前的微任务检查点，去处理其他任务。

微任务适合短小的顺序协调，例如在当前同步代码结束后统一通知状态变化。持续计算需要的是有边界的批次，以及批次之间真正的任务级让步；反复 `await Promise.resolve()` 也不能提供这种边界。

## 队列排空之前，检查点不会结束

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

Promise 的回调与 `await` 后的续体也可能延长这条链。尤其是循环中的 `await Promise.resolve()`：它让当前函数暂停，再以微任务恢复，却没有让定时器任务插到检查点中间。等待真正尚未完成的 I/O 是另一回事，不能仅凭代码里出现了 `await` 判断响应性。[HTML 对 Promise job 的调度](https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuepromisejob)

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

## 用相同批次比较两种调度

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

在 Windows、Node.js 24.19.0 下运行得到以下输出；其中 `immediate` 一行取决于实际调度与计时：

```text
microtask: timer saw all work = true
immediate: timer saw all work = false
both sums match = true
```

第一组的整个微任务链先执行完，定时器才能观察结果。第二组若输出 false，说明定时器在工作结束前获得了执行机会。代码只对第一组的顺序做断言，没有断言第二组必须在第几批插入定时器：批次数、机器速度和计时条件变化后，观察结果可能不同。该程序演示 Node.js 的调度顺序，不测量吞吐量或浏览器的输入、绘制响应。

## Node.js 的 nextTick 顺序要看执行上下文

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

微任务解决当前执行之后的顺序衔接，任务级让步解决其他工作何时有机会运行。判断一段“异步循环”是否会阻塞，关键是找出它何时能结束微任务检查点，以及下一批工作在什么边界重新进入。
