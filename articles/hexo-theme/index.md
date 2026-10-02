---
title: 为 NexT 配置图片预览与背景动效
date: 2019-08-28
updated: 2026-10-02
tags: [Hexo, NexT, 前端]
domain: Hexo
---

图片预览解决正文配图看不清的问题，背景动画只提供视觉装饰。两者都可以通过 NexT 的扩展入口接入，但配置来源和加载方式不同：主题已集成的功能使用配置开关，独立脚本通过自定义模板加载。

本文采用 Hexo 8、NexT 8。先按[Hexo 与 NexT 入门](/hexo-writing/)准备站点，以下路径都相对于站点根目录；主题设置统一写在 `_config.next.yml`。

## 使用主题集成的图片预览

NexT 支持 Fancybox 和 Medium Zoom。前者提供灯箱式图片浏览，后者适合直接放大单张图片；选择一种即可，不要同时启用两种图片点击处理。[NexT 图片预览配置](https://theme-next.js.org/docs/third-party-services/external-libraries)

使用 Fancybox 时添加：

```yaml
fancybox: true
mediumzoom: false
```

正文使用普通 Markdown 图片，例如把一张图片放在 `source/images/network.png` 后引用：

```md
![网络请求经过的组件](/images/network.png)
```

图片路径、主题开关和前端资源缺一不可。NexT 的第三方资源默认通过 CDN 加载；生成成功并不说明访问者能取得这些资源。若图片能显示却无法放大，应先检查浏览器中的脚本请求和控制台，再核对主题设置。[NexT 第三方资源](https://theme-next.js.org/docs/third-party-services/)

## 通过自定义模板添加背景

NexT 8 使用 Nunjucks 模板。创建 `source/_data/body-end.njk`，再将其接入 `_config.next.yml`：

```yaml
custom_file_path:
  bodyEnd: source/_data/body-end.njk
```

如果已经有 `custom_file_path`，在同一个映射中增加 `bodyEnd`，不要重复声明整个键。自定义模板与主题包分开保存，可以避免安装主题时覆盖自己的内容。[NexT 自定义文件](https://theme-next.js.org/docs/advanced-settings/custom-files.html)

在 `body-end.njk` 中加入以下脚本。它只在宽屏且用户没有要求减少动态效果时加载 canvas-nest；`1.0.1` 是固定资源版本：

```html
<script>
  if (window.matchMedia('(min-width: 64rem) and (prefers-reduced-motion: no-preference)').matches) {
    const effect = document.createElement('script');
    effect.src = 'https://cdn.jsdelivr.net/npm/canvas-nest.js@1.0.1/dist/canvas-nest.js';
    effect.setAttribute('color', '75,95,199');
    effect.setAttribute('opacity', '0.25');
    effect.setAttribute('count', '50');
    effect.setAttribute('zIndex', '-1');
    document.body.append(effect);
  }
</script>
```

这里的条件在页面加载时判断，不是在浏览器缩放过程中动态创建和销毁动画。`color` 控制连线颜色，`opacity` 控制透明度，`count` 控制粒子数量；数量增加通常会增加绘制工作，不能只看静态截图来决定取值。[canvas-nest 维护源](https://github.com/hustcc/canvas-nest.js/)

背景是否可见还取决于主题的背景层与遮挡关系。不要通过不断提高 `zIndex` 把动画盖到正文或链接上；若与选用的主题方案冲突，移除这段装饰比破坏阅读更合适。

## 验证读图和阅读流程

执行 `npx hexo clean`、`npx hexo generate --bail` 和 `npx hexo server`，打开真实文章页。图片预览需要检查打开、缩放或切换、关闭及返回正文的位置，触屏与键盘操作也要能够完成。

背景动效需要在宽屏、窄屏、减少动态效果和深浅主题下分别检查。确认正文对比度、链接点击与自然滚动没有受影响，并检查 CDN 请求失败时正文是否仍可阅读。资源能够加载与实际阅读体验良好是两个不同的验收条件。
