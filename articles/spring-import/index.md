---
title: "Import 注解"
date: 2019-07-03
updated: 2026-10-02
tags:
  - Spring
  - Spring-Annotation
domain: Spring
---

`@Import` 把配置类、普通组件以及选择或注册逻辑接入 Spring 的配置处理过程。固定组合可直接导入类；需根据元数据选择导入项时使用 `ImportSelector`；需构造 Bean 定义时使用 `ImportBeanDefinitionRegistrar`。它们承担的扩展职责不同，不必为简单注册引入额外层次。

下面通过示例说明 `@Import` 如何配合 `@Bean` 与配置类。示例使用 Spring Framework 5.2.5.RELEASE，导入能力可对照该版本的 [Import 声明](https://github.com/spring-projects/spring-framework/blob/v5.2.5.RELEASE/spring-context/src/main/java/org/springframework/context/annotation/Import.java)；选择器与注册器主要在配置解析阶段执行，不是每次业务方法调用时动态注入。当前项目还需核对 Bean 名称、重复定义与实际容器配置。


## @Import 的声明

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Import {

	// 要导入的Configuration，ImportSelector，ImportBeanDefinitionRegistrar或常规组件类
	Class<?>[] value();

}
```

## 普通java类

```java
/**
 * @author allurx
 */
@Import(Person.class)
@SpringBootApplication
public class DemoApplication {

    private static ApplicationContext CONTEXT;

    @Autowired
    public DemoApplication(ApplicationContext applicationContext) {
        CONTEXT = applicationContext;
    }

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
        System.out.println(CONTEXT.getBean(Person.class));
    }

    static class Person {

    }

}

```

执行以上代码一个普通的Person对象就被注入到spring容器中了

## spring组件类

```java
package io.allurx;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import io.allurx.DemoApplication.Person;

/**
 * @author allurx
 */
@Import(Person.class)
@SpringBootApplication
public class DemoApplication {

    private static ApplicationContext CONTEXT;

    @Autowired
    public DemoApplication(ApplicationContext applicationContext) {
        CONTEXT = applicationContext;
    }

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
        System.out.println(CONTEXT.getBean(Person.class));
    }

    @Configuration
    static class Person {

    }
}
```

`@Import`导入了被`@Configuration`注解的类，最终Person对象被注入到spring容器中了，这有点多此一举，将

`@Import(Person.class)`去掉，效果也是一样的

## ImportSelector

```java
package io.allurx;

import io.allurx.DemoApplication.EnablePerson;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.ImportSelector;
import org.springframework.core.annotation.AnnotationAttributes;
import org.springframework.core.type.AnnotationMetadata;
import org.springframework.util.Assert;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

/**
 * @author allurx
 */
@EnablePerson(speak = true)
@SpringBootApplication
public class DemoApplication {

    private static ApplicationContext CONTEXT;

    @Autowired
    public DemoApplication(ApplicationContext applicationContext) {
        CONTEXT = applicationContext;
    }

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
        Person person = CONTEXT.getBean(Person.class);
        person.speak();
        person.sing();
    }

    @Configuration
    static class Person {

        SpeakAbility speakAbility;

        SingAbility singAbility;

        @Autowired(required = false)
        void setSpeakAbility(SpeakAbility speakAbility) {
            this.speakAbility = speakAbility;
        }

        @Autowired(required = false)
        void setSingAbility(SingAbility singAbility) {
            this.singAbility = singAbility;
        }

        void speak() {
            if (speakAbility != null) {
                speakAbility.speak();
                return;
            }
            System.out.println("我不能够说话");
        }

        void sing() {
            if (singAbility != null) {
                singAbility.sing();
                return;
            }
            System.out.println("我不能够唱歌");
        }
    }

    @Retention(RUNTIME)
    @Target(TYPE)
    @Documented
    @Import(PersonSelector.class)
    @interface EnablePerson {

        boolean speak() default false;

        boolean sing() default false;

    }

    static class SpeakAbility {
        void speak() {
            System.out.println("我能够说话");
        }
    }

    static class SingAbility {
        void sing() {
            System.out.println("我能够唱歌");
        }
    }

    static class PersonSelector implements ImportSelector {

        @Override
        public String[] selectImports(AnnotationMetadata importingClassMetadata) {
            // 获取EnablePerson注解里面的所有参数值
            Map<String, Object> annotationAttributes = importingClassMetadata
                    .getAnnotationAttributes(EnablePerson.class.getName(), false);
            // 将map转换为AnnotationAttributes
            AnnotationAttributes attributes = AnnotationAttributes
                    .fromMap(annotationAttributes);
            Assert.notNull(attributes, () -> "attributes can not be null");
            boolean speak = attributes.getBoolean("speak");
            boolean sign = attributes.getBoolean("sing");
            List<String> list = new ArrayList<>(2);
            // 如果speak为true的话，将SpeakAbility注入到spring容器中
            if (speak) {
                list.add(SpeakAbility.class.getName());
            }
            // 如果sing为true，将SingAbility注入到spring容器中
            if (sign) {
                list.add(SingAbility.class.getName());
            }
            return list.toArray(new String[0]);
        }
    }
}
```

1. 定义一个`@EnablePerson`注解，该注解有两个属性，代表是否能够说话和唱歌

2. `@EnablePerson`注解被`@Import(PersonSelector.class)`注解，这个PersonSelector很关键，spring会在应用启动时根据这个PersonSelector方法返回的类名称数组，将这些类都注册到spring容器中，在PersonSelector的selectImports方法中，我们能够获取到AnnotationMetadata，这个AnnotationMetadata就是`@EnablePerson`注解的类上的所有注解信息，（这里就是DemoApplication类上的注解信息，分别是`@EnablePerson(speak = true)`和`@SpringBootApplication`），然后我们就可以拿到`@EnablePerson`注解配置的属性，再根据这些属性动态的配置需要注册到spring容器中的bean的名字，因为speak=true，所以最终只有一个SpeakAbility类被注册到了spring容器中

3. 最终程序输出

   ```
   我能够说话
   我不能够唱歌
   ```

   当然了，我们也可以修改sing=true，SingAbility就被注册到spring容器中了

## ImportBeanDefinitionRegistrar类型

```java
package io.allurx;

import io.allurx.DemoApplication.PersonRegistrar;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.ImportBeanDefinitionRegistrar;
import org.springframework.core.type.AnnotationMetadata;

/**
 * @author allurx
 */
@Import(PersonRegistrar.class)
@SpringBootApplication
public class DemoApplication {

    private static ApplicationContext CONTEXT;

    @Autowired
    public DemoApplication(ApplicationContext applicationContext) {
        CONTEXT = applicationContext;
    }

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
        System.out.println(CONTEXT.getBean(Person.class));
    }

    static class Person {

    }

    static class PersonRegistrar implements ImportBeanDefinitionRegistrar {

        @Override
        public void registerBeanDefinitions(AnnotationMetadata importingClassMetadata, BeanDefinitionRegistry registry) {
            RootBeanDefinition rootBeanDefinition = new RootBeanDefinition(Person.class);
            registry.registerBeanDefinition("person", rootBeanDefinition);
        }
    }
}
```

`@Import(PersonRegistrar.class)`添加了一个ImportBeanDefinitionRegistrar实例，使用该方式注册，PersonRegistrar就拥有了手动注册bean的能力，它能够将某个类构造成RootBeanDefinition，然后将这个bean注册到BeanDefinitionRegistry中

## 总结

* 前两种注册bean的方式一般很少用到，因为我们可以直接通过`@Configuration`这种方式让spring帮我们注册bean
* 后面两种注册方式多见于spring的一些自动配置中，当我们需要根据代码中的配置动态的在程序运行时注册一些bean时，（例如根据注解的属性注册不同的配置）我们就可以使用该方式注册

## 资料来源

- [Spring Framework：@Import API](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/annotation/Import.html)
- [Spring Framework：组合 Java 配置](https://docs.spring.io/spring-framework/reference/core/beans/java/composing-configuration-classes.html)
