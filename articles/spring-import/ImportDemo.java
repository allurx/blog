package io.allurx;

import java.lang.annotation.Retention;
import java.lang.annotation.Target;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.ImportBeanDefinitionRegistrar;
import org.springframework.context.annotation.ImportSelector;
import org.springframework.core.annotation.AnnotationAttributes;
import org.springframework.core.type.AnnotationMetadata;

import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

/**
 * 演示直接导入、配置组合、条件选择与 Bean 定义注册。
 *
 * @author allurx
 */
public class ImportDemo {
    public static void main(String[] args) {
        // 每种方式使用独立容器，避免组件扫描或前一个例子的 Bean 干扰结果。
        try (var context = new AnnotationConfigApplicationContext(DirectConfig.class)) {
            System.out.println("direct=" + context.getBean(Person.class).name());
        }

        try (var context = new AnnotationConfigApplicationContext(ComposedConfig.class)) {
            System.out.println("configuration=" + context.getBean(Person.class).name());
        }

        try (var context = new AnnotationConfigApplicationContext(SpeakingConfig.class)) {
            printAbilities("selected", context);
        }

        try (var context = new AnnotationConfigApplicationContext(SingingConfig.class)) {
            printAbilities("alternative", context);
        }

        try (var context = new AnnotationConfigApplicationContext(RegisteredConfig.class)) {
            System.out.println("registered=" + context.getBean("person", Person.class).name());
        }
    }

    private static void printAbilities(String label, AnnotationConfigApplicationContext context) {
        boolean speaks = !context.getBeansOfType(SpeakAbility.class).isEmpty();
        boolean sings = !context.getBeansOfType(SingAbility.class).isEmpty();
        System.out.println(label + ": speak=" + speaks + ", sing=" + sings);
    }

    public static class Person {
        public String name() {
            return "allurx";
        }
    }

    @Configuration(proxyBeanMethods = false)
    @Import(Person.class)
    public static class DirectConfig {
    }

    @Configuration(proxyBeanMethods = false)
    public static class PersonConfig {
        @Bean
        public Person person() {
            return new Person();
        }
    }

    @Configuration(proxyBeanMethods = false)
    @Import(PersonConfig.class)
    public static class ComposedConfig {
    }

    @Retention(RUNTIME)
    @Target(TYPE)
    @Import(PersonSelector.class)
    public @interface EnableAbilities {
        boolean speak() default false;

        boolean sing() default false;
    }

    public static class SpeakAbility {
    }

    public static class SingAbility {
    }

    public static class PersonSelector implements ImportSelector {
        @Override
        public String[] selectImports(AnnotationMetadata importingClassMetadata) {
            AnnotationAttributes attributes = AnnotationAttributes.fromMap(
                    importingClassMetadata.getAnnotationAttributes(EnableAbilities.class.getName()));
            if (attributes == null) {
                throw new IllegalStateException("PersonSelector requires @EnableAbilities");
            }

            List<String> imports = new ArrayList<>();
            if (attributes.getBoolean("speak")) {
                imports.add(SpeakAbility.class.getName());
            }
            if (attributes.getBoolean("sing")) {
                imports.add(SingAbility.class.getName());
            }
            return imports.toArray(String[]::new);
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableAbilities(speak = true)
    public static class SpeakingConfig {
    }

    @Configuration(proxyBeanMethods = false)
    @EnableAbilities(sing = true)
    public static class SingingConfig {
    }

    public static class PersonRegistrar implements ImportBeanDefinitionRegistrar {
        @Override
        public void registerBeanDefinitions(AnnotationMetadata importingClassMetadata,
                BeanDefinitionRegistry registry) {
            registry.registerBeanDefinition("person", new RootBeanDefinition(Person.class));
        }
    }

    @Configuration(proxyBeanMethods = false)
    @Import(PersonRegistrar.class)
    public static class RegisteredConfig {
    }
}
