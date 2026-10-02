---
title: "JPMS 下 ServiceLoader 为什么需要 uses 与 provides"
date: 2026-09-18
updated: 2026-10-01
domain: "JDK"
tags: ["JPMS","ServiceLoader","SPI"]
---

一个 SPI 程序可以只编译依赖服务接口，却在部署时换掉实现 JAR。进入 JPMS 后，这种解耦需要写进模块描述符：消费模块声明 `uses`，提供模块声明 `provides ... with ...`。把 JAR 放到 module path，仅仅提供了候选模块，并不等于它已经进入运行时模块图。

排查“找不到实现”时，先区分两步：模块解析时的服务绑定决定哪些提供者进入图，`ServiceLoader` 再定位并按需实例化它们。实现包通常不需要 `exports` 或 `opens`；消费方也不应为了发现实现而直接 `requires` 提供者。本文以 JDK 27 API 说明为背景，示例采用 Java 17 可编译的语法；JPMS 服务机制自 Java 9 起可用。

## 用三个模块分开接口、消费方和提供者

JPMS 同时维护两类关系：

1. **可读性关系**：`requires` 让一个模块读取另一个模块，供普通类型链接使用。
2. **服务关系**：`uses S` 表示消费服务 `S`，`provides S with P` 表示类 `P` 提供服务 `S`。

服务 API 模块只导出接口包：

```java
module io.allurx.greeting.api {
    exports io.allurx.greeting.api;
}
```

消费模块读取 API，并声明服务使用点：

```java
module io.allurx.greeting.app {
    requires io.allurx.greeting.api;
    uses io.allurx.greeting.api.GreetingService;
}
```

提供模块读取 API，并登记实现：

```java
module io.allurx.greeting.provider {
    requires io.allurx.greeting.api;
    provides io.allurx.greeting.api.GreetingService
        with io.allurx.greeting.provider.FriendlyGreeting;
}
```

注意消费模块没有 `requires io.allurx.greeting.provider`。这是刻意设计：若消费方直接读取并引用实现模块，SPI 就退化为编译期耦合。Oracle 文档也明确建议应用模块不要 `requires` 包含提供者的模块，并建议提供模块不要导出实现包。

启动时，解析器从根模块计算依赖闭包。因为应用声明了 `uses GreetingService`，服务绑定还会寻找声明 `provides GreetingService` 的可观察模块，将匹配的提供者及其依赖纳入配置。于是提供者能进入启动层，即使它不是消费方普通 `requires` 边的目标。`uses` 既给运行时做合法性检查，也让解析器知道哪个服务会影响模块图。

这不等于消费模块获得了实现包的普通访问权。实现包仍被强封装；应用只持有导出的 `GreetingService` 类型。`ServiceLoader` 按模块描述符中的受控入口创建实例，提供者不必向消费方 `exports` 或 `opens` 实现包。服务声明因此同时实现了可发现性与封装性。

## 服务加载发生在什么范围和时机

`ServiceLoader.load(GreetingService.class)` 的关键步骤可以理解为：

1. 检查调用者。如果调用者位于显式命名模块，而模块描述符没有 `uses GreetingService`，立即抛出 `ServiceConfigurationError`；这不是“返回空集合”。
2. 在适用的模块层和类加载器范围内定位提供者。命名模块以 `provides` 为准；未命名模块则从 `META-INF/services/<服务全名>` 读取配置。
3. 懒加载提供者。创建 `ServiceLoader` 本身不保证已经加载全部实现；迭代、`findFirst()` 或消费 `stream()` 才触发定位或实例化，并把已加载项缓存到该 loader 实例中。
4. 创建提供者实例。命名模块的提供者可以使用公开无参构造器，也可以声明 `public static provider()` 无参方法并返回服务类型；自动模块和类路径提供者不支持这种 provider method 形式，只能走公开无参构造器。详见 [JDK 27 `ServiceLoader` 的提供者规则](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/ServiceLoader.html#deploying-service-providers-as-modules)。

`stream()` 返回 `ServiceLoader.Provider<S>`，可以先调用 `type()`，再由 `get()` 实例化。使用 provider method 时，`type()` 返回的是该方法声明的返回类型，未必是实际实例类型；不能一概用它扫描实现类上的注解。同一模块内的 provider 按描述符顺序发现，不同模块之间顺序未定义，业务优先级应单独建模。

缓存也有边界。`reload()` 会清空某个 `ServiceLoader` 实例的 provider 缓存，却不会重新解析启动层，也不会把后来复制到 module path 的模块自动装入既有层。动态插件需要创建新的 `ModuleLayer`，再调用 `ServiceLoader.load(layer, Service.class)`；该重载只搜索指定层及其祖先中的命名模块。`ServiceLoader` 实例本身也不是线程安全的，不能让多个线程无保护地共享迭代与 `reload()`。

## 编译并启动一个不依赖实现模块的应用

前文三个 `module-info.java` 分别保存到 `src/io.allurx.greeting.api/`、`src/io.allurx.greeting.app/` 和 `src/io.allurx.greeting.provider/`。再创建下面三个 Java 源文件，使用 Java 17+ 编译。

`src/io.allurx.greeting.api/io/allurx/greeting/api/GreetingService.java`：

```java
package io.allurx.greeting.api;

public interface GreetingService {
    String greet(String name);
}
```

`src/io.allurx.greeting.provider/io/allurx/greeting/provider/FriendlyGreeting.java`，所在包不导出：

```java
package io.allurx.greeting.provider;

import io.allurx.greeting.api.GreetingService;

public final class FriendlyGreeting implements GreetingService {
    public FriendlyGreeting() {}

    @Override
    public String greet(String name) {
        return "hello, " + name;
    }
}
```

`src/io.allurx.greeting.app/io/allurx/greeting/app/Main.java`，只依赖 API：

```java
package io.allurx.greeting.app;

import io.allurx.greeting.api.GreetingService;
import java.util.ServiceLoader;

public final class Main {
    public static void main(String[] args) {
        var services = ServiceLoader.load(GreetingService.class)
                .stream().map(ServiceLoader.Provider::get).toList();
        if (services.size() != 1) throw new IllegalStateException("expected one provider");
        GreetingService service = services.get(0);
        System.out.println("provider=" + service.getClass().getName());
        System.out.println("module=" + service.getClass().getModule().getName());
        System.out.println(service.greet("reader"));
    }
}
```

在包含 `src` 的实验目录执行以下命令。编译器同时编译三个模块，启动时只指定应用模块：

```bash
javac --release 17 --module-source-path src -d mods \
  src/io.allurx.greeting.api/module-info.java \
  src/io.allurx.greeting.app/module-info.java \
  src/io.allurx.greeting.provider/module-info.java \
  src/io.allurx.greeting.api/io/allurx/greeting/api/GreetingService.java \
  src/io.allurx.greeting.provider/io/allurx/greeting/provider/FriendlyGreeting.java \
  src/io.allurx.greeting.app/io/allurx/greeting/app/Main.java
java --module-path mods -m io.allurx.greeting.app/io.allurx.greeting.app.Main
```

以上续行语法用于 Bash；PowerShell 可将 `javac` 命令合并为一行。2026-10-01 修订时，在 JDK 25.0.2 上以 `--release 17` 编译六个源文件，运行输出：

```text
provider=io.allurx.greeting.provider.FriendlyGreeting
module=io.allurx.greeting.provider
hello, reader
```

消费模块没有 `requires` 提供者，仍应找到它，原因是 Java 启动器的服务绑定。可进一步做两组对照，每次修改后重新编译到独立输出目录，避免上一组 class 残留：

```text
# 消费模块遗漏 uses
java.util.ServiceConfigurationError: ... module ... does not declare `uses`

# 提供模块遗漏 provides
java.lang.IllegalStateException: expected one provider
```

两组对照在同次修订中分别编译运行，均得到上述错误。第二组没有服务注册，枚举得到零个实现，由启动检查报错。自定义模块层还应留意 `Configuration.resolve` 与 `resolveAndBind` 的区别：仅解析普通依赖不等于执行服务绑定。[JDK 27 `Configuration.resolveAndBind`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/module/Configuration.html#resolveAndBind(java.lang.module.ModuleFinder,java.lang.module.ModuleFinder,java.util.Collection))

## 把发现规则变成可检查的部署契约

**把 API、消费方和实现方分开。** API 模块只放稳定的小接口与跨边界数据类型；提供者模块可以拥有数据库驱动、SDK 等私有依赖。消费方不导入实现类，也不把实现模块写进 `requires`。

**启动时做确定性校验。** `ServiceLoader` 合法地允许零个、一个或多个实现。业务若要求“恰好一个”，应在启动探针中完整枚举并显式报错；若允许多个，应按业务字段排序而不是依赖发现顺序。迭代和实例化可能抛 `ServiceConfigurationError`，错误应带上服务名、模块层和可见 provider 信息。

**不要把 DI 容器构造逻辑塞进 provider 构造器。** ServiceLoader 只支持规定的无参创建入口。更实用的设计是让 provider 本身成为轻量工厂，随后由其方法接收配置并创建真正的重对象；这也符合官方对昂贵服务使用 factory/proxy 的建议。

**区分 module path 与 class path。** 命名模块以 `provides` 为注册源。类路径 JAR 使用 UTF-8 的 `META-INF/services` 文件。一个已经位于命名模块中的 provider，即使还带着同名配置文件，也不会因此获得第二份注册；不要依赖双轨元数据掩盖错误的模块描述符。

**自定义运行时镜像要验证服务绑定。** `jlink` 默认按根模块和普通依赖闭包裁剪，可能不包含只通过 SPI 到达的 provider。可显式 `--add-modules` 选定实现，或使用 `--bind-services` 链接提供者及其依赖；`--suggest-providers <服务类型>` 可先检查候选。选项语义见 [JDK 27 `jlink` 文档](https://docs.oracle.com/en/java/javase/27/docs/specs/man/jlink.html)。镜像测试应真正运行 SPI 探针，不能只检查 JAR 是否在构建输入中。

**对动态插件使用模块层。** 运行中加入插件时，先用新的配置解析插件模块并创建子 `ModuleLayer`，再以该层调用 `ServiceLoader.load(layer, service)`。仅修改线程上下文类加载器无法把新命名模块塞进已有启动层。
