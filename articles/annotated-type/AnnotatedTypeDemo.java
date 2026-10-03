package io.allurx;

import java.io.Serializable;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.reflect.AnnotatedArrayType;
import java.lang.reflect.AnnotatedParameterizedType;
import java.lang.reflect.AnnotatedType;
import java.lang.reflect.AnnotatedTypeVariable;
import java.lang.reflect.AnnotatedWildcardType;
import java.util.List;

/**
 * 演示无环类型声明中各个注解位置的读取。
 *
 * @author allurx
 */
public class AnnotatedTypeDemo<
        T extends @AnnotatedTypeDemo.Mark(4) Number
                & @AnnotatedTypeDemo.Mark(5) Serializable> {

    List<@Mark(1) String> names;
    List<@Mark(2) List<@Mark(3) String>> groups;
    @Mark(6) T value;
    List<? extends @Mark(7) Number> producers;
    List<? super @Mark(8) Number> consumers;
    @Mark(9) String @Mark(10) [] @Mark(11) [] matrix;

    public static void main(String[] args) throws ReflectiveOperationException {
        for (String name : List.of(
                "names", "groups", "value", "producers", "consumers", "matrix")) {
            print(name, AnnotatedTypeDemo.class.getDeclaredField(name).getAnnotatedType());
        }
    }

    private static void print(String path, AnnotatedType type) {
        Mark mark = type.getAnnotation(Mark.class);
        System.out.println(path + ": " + (mark == null ? "-" : mark.value()));

        // 每次只读取当前节点，子结构统一交给递归处理。
        if (type instanceof AnnotatedParameterizedType parameterized) {
            printChildren(path + ".argument", parameterized.getAnnotatedActualTypeArguments());
        } else if (type instanceof AnnotatedTypeVariable variable) {
            printChildren(path + ".bound", variable.getAnnotatedBounds());
        } else if (type instanceof AnnotatedWildcardType wildcard) {
            printChildren(path + ".upper", wildcard.getAnnotatedUpperBounds());
            printChildren(path + ".lower", wildcard.getAnnotatedLowerBounds());
        } else if (type instanceof AnnotatedArrayType array) {
            print(path + ".component", array.getAnnotatedGenericComponentType());
        }
    }

    private static void printChildren(String path, AnnotatedType[] types) {
        for (int i = 0; i < types.length; i++) {
            print(path + "[" + i + "]", types[i]);
        }
    }

    @Target(ElementType.TYPE_USE)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface Mark {
        int value();
    }
}
