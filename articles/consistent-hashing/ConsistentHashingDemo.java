import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Locale;
import java.util.NavigableMap;
import java.util.TreeMap;
import java.util.function.LongToIntFunction;

public final class ConsistentHashingDemo {
    private static final int KEY_COUNT = 100_000;
    private static final MessageDigest DIGEST = newDigest();

    private static MessageDigest newDigest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new AssertionError(error);
        }
    }

    // 本程序单线程使用该摘要实例，digest 完成后自动重置。
    private static long hash64(String value) {
        byte[] bytes = DIGEST.digest(value.getBytes(StandardCharsets.UTF_8));
        return ByteBuffer.wrap(bytes).getLong();
    }

    private static LongToIntFunction ring(int nodes, int tokensPerNode) {
        NavigableMap<Long, Integer> tokens = new TreeMap<>(Long::compareUnsigned);
        for (int node = 0; node < nodes; node++) {
            for (int token = 0; token < tokensPerNode; token++) {
                long position = hash64("node-" + node + "#" + token);
                if (tokens.putIfAbsent(position, node) != null) {
                    throw new AssertionError("token collision");
                }
            }
        }
        return key -> {
            var next = tokens.ceilingEntry(key);
            return (next == null ? tokens.firstEntry() : next).getValue();
        };
    }

    private static void compare(String name, long[] keys,
                                LongToIntFunction before,
                                LongToIntFunction after,
                                boolean checkRingProperty) {
        int moved = 0;
        int[] loads = new int[5];
        for (long key : keys) {
            int oldOwner = before.applyAsInt(key);
            int newOwner = after.applyAsInt(key);
            loads[newOwner]++;
            if (oldOwner != newOwner) {
                moved++;
                if (checkRingProperty && newOwner != 4) {
                    throw new AssertionError("an old node gained remapped keys");
                }
            }
        }
        double mean = keys.length / 5.0;
        double variance = Arrays.stream(loads)
                .mapToDouble(load -> Math.pow(load - mean, 2))
                .average().orElseThrow();
        double cv = Math.sqrt(variance) / mean;
        System.out.printf(Locale.ROOT,
                "%s moved=%d (%.2f%%) cv=%.4f loads=%s%n",
                name, moved, moved * 100.0 / keys.length, cv,
                Arrays.toString(loads));
    }

    public static void main(String[] args) {
        long[] keys = new long[KEY_COUNT];
        for (int i = 0; i < keys.length; i++) keys[i] = hash64("key-" + i);

        compare("modulo", keys,
                key -> (int) Long.remainderUnsigned(key, 4),
                key -> (int) Long.remainderUnsigned(key, 5), false);
        compare("ring-1", keys, ring(4, 1), ring(5, 1), true);
        compare("ring-128", keys, ring(4, 128), ring(5, 128), true);
    }
}
