package io.allurx;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/**
 * 用 Java 25 标准库复现 Bloom Filter 的概率与容量实验。
 */
public class BloomFilterDemo {
    private record Parameters(int m, int k) {}

    private static double estimatedFpr(int m, int k, int n) {
        return Math.pow(1 - Math.exp(-(double) k * n / m), k);
    }

    private static Parameters parameters(int capacity, double target) {
        int m = (int) Math.ceil(-capacity * Math.log(target) / Math.pow(Math.log(2), 2));
        double optimum = (double) m / capacity * Math.log(2);

        // 在连续最优点两侧比较合法整数，使用同一个近似公式选择较小误判率。
        int lower = Math.max(1, (int) Math.floor(optimum));
        int upper = Math.max(1, (int) Math.ceil(optimum));
        int k = estimatedFpr(m, lower, capacity) <= estimatedFpr(m, upper, capacity)
                ? lower : upper;
        return new Parameters(m, k);
    }

    /**
     * 仅用于顺序插入和查询的教学实现，不支持删除或并发访问。
     */
    private static final class BloomFilter {
        private final int m;
        private final int k;
        private final byte[] bits;
        private final MessageDigest hash;

        BloomFilter(int m, int k) throws NoSuchAlgorithmException {
            this.m = m;
            this.k = k;
            this.bits = new byte[(m + 7) / 8];
            this.hash = MessageDigest.getInstance("SHA-256");
        }

        private int position(byte[] key, int index) {
            // 固定四字节大端前缀；digest(key) 完成计算后自动重置哈希状态。
            hash.update((byte) (index >>> 24));
            hash.update((byte) (index >>> 16));
            hash.update((byte) (index >>> 8));
            hash.update((byte) index);
            byte[] digest = hash.digest(key);

            // 显式使用正号，将全部 256 位按无符号大端整数解释。
            return new BigInteger(1, digest).mod(BigInteger.valueOf(m)).intValue();
        }

        void add(byte[] key) {
            for (int index = 0; index < k; index++) {
                int position = position(key, index);
                bits[position / 8] |= 1 << (position % 8);
            }
        }

        boolean mightContain(byte[] key) {
            for (int index = 0; index < k; index++) {
                int position = position(key, index);
                if ((bits[position / 8] & (1 << (position % 8))) == 0) {
                    return false;
                }
            }
            return true;
        }

        int setBits() {
            int count = 0;
            for (byte value : bits) {
                count += Integer.bitCount(Byte.toUnsignedInt(value));
            }
            return count;
        }
    }

    private static int tinyFalsePositives() {
        int positives = 0;
        // 四个二选一的位置共有 16 种等可能组合，低两位对应插入位置。
        for (int outcome = 0; outcome < 16; outcome++) {
            int insertA = outcome & 1;
            int insertB = (outcome >>> 1) & 1;
            int queryA = (outcome >>> 2) & 1;
            int queryB = (outcome >>> 3) & 1;

            if ((queryA == insertA || queryA == insertB)
                    && (queryB == insertA || queryB == insertB)) {
                positives++;
            }
        }
        return positives;
    }

    public static void main(String[] args) throws NoSuchAlgorithmException {
        int tinyPositives = tinyFalsePositives();
        if (tinyPositives != 10) {
            throw new AssertionError("小例子应有 10/16 个误判组合，实际为 " + tinyPositives);
        }
        double expectedSetFraction = 1 - Math.pow(0.5, 2);
        double shortcut = Math.pow(expectedSetFraction, 2);
        System.out.printf("tiny: exact=%d/8, shortcut=%d/16%n",
                tinyPositives / 2, (int) (shortcut * 16));

        int capacity = 1_000;
        int queries = 100_000;
        Parameters parameters = parameters(capacity, 0.01);
        BloomFilter bloom = new BloomFilter(parameters.m(), parameters.k());
        System.out.printf("m=%d, k=%d, payload_bytes=%d%n",
                parameters.m(), parameters.k(), bloom.bits.length);

        int inserted = 0;
        for (int count : new int[] {capacity, 2 * capacity}) {
            // 第二阶段复用同一位数组，只追加此前没有插入的键。
            for (int index = inserted; index < count; index++) {
                bloom.add(("member:" + index).getBytes(StandardCharsets.US_ASCII));
            }
            inserted = count;

            int falseNegatives = 0;
            for (int index = 0; index < count; index++) {
                if (!bloom.mightContain(("member:" + index).getBytes(StandardCharsets.US_ASCII))) {
                    falseNegatives++;
                }
            }

            int falsePositives = 0;
            for (int index = 0; index < queries; index++) {
                if (bloom.mightContain(("absent:" + index).getBytes(StandardCharsets.US_ASCII))) {
                    falsePositives++;
                }
            }

            if (falseNegatives != 0) {
                throw new AssertionError("已插入键发生漏判：" + falseNegatives);
            }
            System.out.printf(Locale.ROOT,
                    "n=%d, set_bits=%d, false_negatives=%d, false_positives=%d/%d, "
                            + "observed=%.4f%%, estimated=%.4f%%%n",
                    count, bloom.setBits(), falseNegatives, falsePositives, queries,
                    100.0 * falsePositives / queries,
                    100 * estimatedFpr(parameters.m(), parameters.k(), count));
        }
    }
}
