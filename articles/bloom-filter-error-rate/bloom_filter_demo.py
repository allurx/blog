"""Reproduce the Bloom filter examples with Python 3.12 and its standard library."""

from collections.abc import Iterator
from fractions import Fraction
from hashlib import sha256
from itertools import product
from math import ceil, exp, floor, log


def estimated_fpr(m: int, k: int, n: int) -> float:
    return (1 - exp(-k * n / m)) ** k


def parameters(capacity: int, target: float) -> tuple[int, int]:
    m = ceil(-capacity * log(target) / log(2) ** 2)
    optimum = m / capacity * log(2)
    candidates = {max(1, floor(optimum)), max(1, ceil(optimum))}
    k = min(candidates, key=lambda candidate: estimated_fpr(m, candidate, capacity))
    return m, k


class BloomFilter:
    """A sequential, insert-only teaching implementation, not a production library."""

    def __init__(self, m: int, k: int) -> None:
        self.m = m
        self.k = k
        self.bits = bytearray((m + 7) // 8)

    def positions(self, key: bytes) -> Iterator[int]:
        for index in range(self.k):
            # A fixed-width prefix separates the k hash inputs reproducibly.
            digest = sha256(index.to_bytes(4, "big") + key).digest()
            yield int.from_bytes(digest, "big") % self.m

    def add(self, key: bytes) -> None:
        for position in self.positions(key):
            self.bits[position // 8] |= 1 << (position % 8)

    def might_contain(self, key: bytes) -> bool:
        return all(
            self.bits[position // 8] & (1 << (position % 8))
            for position in self.positions(key)
        )

    def set_bits(self) -> int:
        return sum(byte.bit_count() for byte in self.bits)


def exact_tiny_case() -> Fraction:
    # One inserted key and one absent query; each has two independent bit choices.
    outcomes = list(product(range(2), repeat=4))
    positives = sum(
        query_a in {insert_a, insert_b} and query_b in {insert_a, insert_b}
        for insert_a, insert_b, query_a, query_b in outcomes
    )
    return Fraction(positives, len(outcomes))


def main() -> None:
    exact = exact_tiny_case()
    shortcut = (1 - Fraction(1, 2) ** 2) ** 2
    assert exact == Fraction(5, 8)
    print(f"tiny: exact={exact}, shortcut={shortcut}")

    capacity = 1_000
    queries = 100_000
    m, k = parameters(capacity, 0.01)
    bloom = BloomFilter(m, k)
    print(f"m={m}, k={k}, payload_bytes={len(bloom.bits)}")

    inserted = 0
    for count in (capacity, 2 * capacity):
        for index in range(inserted, count):
            bloom.add(f"member:{index}".encode("ascii"))
        inserted = count

        false_negatives = sum(
            not bloom.might_contain(f"member:{index}".encode("ascii"))
            for index in range(count)
        )
        false_positives = sum(
            bloom.might_contain(f"absent:{index}".encode("ascii"))
            for index in range(queries)
        )
        assert false_negatives == 0
        print(
            f"n={count}, set_bits={bloom.set_bits()}, "
            f"false_negatives={false_negatives}, "
            f"false_positives={false_positives}/{queries}, "
            f"observed={false_positives / queries:.4%}, "
            f"estimated={estimated_fpr(m, k, count):.4%}"
        )


if __name__ == "__main__":
    main()
