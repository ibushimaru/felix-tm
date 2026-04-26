"""Python search benchmark — synthetic TM of 10k rows, 100 queries.

Run from repo root: .venv/bin/python tests/bench_search.py
Not in pytest — kept out of the test discovery so suite stays fast.
"""

from __future__ import annotations

import random
import time

from felix_tm.core.match_maker import MatchConfig, match_score
from felix_tm.core.segment import Segment

POOL = (
    "abcdefghijklmnopqrstuvwxyz0123456789 "
    "光属性闇属性ダメージ攻撃力防御力魔力素早さHP MP ATK DEF MATK MIND "
)


def random_segment(rand: random.Random, min_len: int, max_len: int) -> str:
    n = rand.randint(min_len, max_len)
    return "".join(rand.choice(POOL) for _ in range(n))


def build_tm(rand: random.Random, n: int) -> list[Segment]:
    return [Segment(random_segment(rand, 30, 80)) for _ in range(n)]


def build_queries(rand: random.Random, n: int) -> list[Segment]:
    return [Segment(random_segment(rand, 30, 80)) for _ in range(n)]


def bench(label: str, fn) -> None:
    # Warm up.
    for _ in range(3):
        fn()
    t0 = time.perf_counter()
    result = fn()
    t1 = time.perf_counter()
    print(f"{label:<40} {(t1 - t0) * 1000:.1f} ms   {result}")


SEED = 42
TM_SIZE = 10_000
QUERY_COUNT = 100


def main() -> None:
    rand = random.Random(SEED)
    print(f"Building TM ({TM_SIZE} entries)...")
    tm = build_tm(rand, TM_SIZE)

    rand2 = random.Random(SEED + 1)
    print(f"Building queries ({QUERY_COUNT})...")
    queries = build_queries(rand2, QUERY_COUNT)

    print(f"\n--- match_score over {TM_SIZE} entries × {QUERY_COUNT} queries ---")
    for ms in (0.5, 0.7, 0.9):
        cfg = MatchConfig(min_score=ms)
        def runner(cfg=cfg):
            hits = 0
            for q in queries:
                for entry in tm:
                    if match_score(q, entry, cfg) >= cfg.min_score:
                        hits += 1
            return f"total hits={hits}"
        bench(f"match_score min_score={ms}", runner)


if __name__ == "__main__":
    main()
