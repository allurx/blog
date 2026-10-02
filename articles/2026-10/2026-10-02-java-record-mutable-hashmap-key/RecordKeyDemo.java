package io.allurx;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class RecordKeyDemo {
    record Key(List<String> tags) {}

    record SnapshotKey(List<String> tags) {
        SnapshotKey {
            tags = List.copyOf(tags);
        }
    }

    record NestedKey(List<List<String>> groups) {
        NestedKey {
            groups = List.copyOf(groups);
        }
    }

    record GroupSnapshotKey(List<List<String>> groups) {
        GroupSnapshotKey {
            groups = groups.stream().map(List::copyOf).toList();
        }
    }

    public static void main(String[] args) {
        mutableKey();
        unmodifiableView();
        snapshotKey();
        nestedKey();
        groupSnapshotKey();
    }

    private static void mutableKey() {
        var tags = new ArrayList<>(List.of("java"));
        var key = new Key(tags);
        Map<Key, String> cache = new HashMap<>();
        cache.put(key, "cached");
        check("cached".equals(cache.get(key)), "initial lookup");
        int before = key.hashCode();

        tags.add("jvm");
        boolean sameReference = cache.keySet().iterator().next() == key;
        boolean changed = before != key.hashCode();
        check(changed && sameReference && cache.get(key) == null, "mutable key lookup");
        System.out.printf("mutable: hashChanged=%s, sameReference=%s, size=%d, get=%s%n",
                changed, sameReference, cache.size(), cache.get(key));
    }

    private static void unmodifiableView() {
        var tags = new ArrayList<>(List.of("java"));
        var key = new Key(Collections.unmodifiableList(tags));
        Map<Key, String> cache = new HashMap<>();
        cache.put(key, "cached");
        expectUnsupported(() -> key.tags().add("blocked"));

        tags.add("jvm");
        check(key.tags().size() == 2 && cache.get(key) == null, "view is still live");
        System.out.printf("view: tags=%s, get=%s%n", key.tags(), cache.get(key));
    }

    private static void snapshotKey() {
        var tags = new ArrayList<>(List.of("java"));
        var key = new SnapshotKey(tags);
        Map<SnapshotKey, String> cache = new HashMap<>();
        cache.put(key, "cached");
        tags.add("jvm");
        expectUnsupported(() -> key.tags().add("blocked"));

        String result = cache.get(new SnapshotKey(List.of("java")));
        check(key.tags().equals(List.of("java")) && "cached".equals(result), "snapshot lookup");
        System.out.printf("snapshot: tags=%s, equivalentKeyGet=%s%n", key.tags(), result);
    }

    private static void nestedKey() {
        var group = new ArrayList<>(List.of("java"));
        var key = new NestedKey(List.of(group));
        Map<NestedKey, String> cache = new HashMap<>();
        cache.put(key, "cached");
        expectUnsupported(() -> key.groups().add(List.of("blocked")));
        key.groups().get(0).add("jvm");

        check(group.size() == 2 && cache.get(key) == null, "nested alias lookup");
        System.out.printf("nested: groups=%s, get=%s%n", key.groups(), cache.get(key));
    }

    private static void groupSnapshotKey() {
        var group = new ArrayList<>(List.of("java"));
        var key = new GroupSnapshotKey(List.of(group));
        Map<GroupSnapshotKey, String> cache = new HashMap<>();
        cache.put(key, "cached");
        group.add("jvm");
        expectUnsupported(() -> key.groups().add(List.of("blocked")));
        expectUnsupported(() -> key.groups().get(0).add("blocked"));

        String result = cache.get(new GroupSnapshotKey(List.of(List.of("java"))));
        check(key.groups().equals(List.of(List.of("java"))) && "cached".equals(result),
                "group snapshot lookup");
        System.out.printf("groupSnapshot: groups=%s, equivalentKeyGet=%s%n", key.groups(), result);
    }

    private static void expectUnsupported(Runnable mutation) {
        try {
            mutation.run();
        } catch (UnsupportedOperationException expected) {
            return;
        }
        throw new AssertionError("Mutation unexpectedly succeeded");
    }

    private static void check(boolean condition, String description) {
        if (!condition) {
            throw new AssertionError(description);
        }
    }
}
