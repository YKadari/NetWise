import pytest

from backend.app.optimization.pareto import dominates, pareto_frontier


def test_dominance_requires_one_strict_improvement():
    assert dominates((1000, 3, 1), (1100, 3, 2))
    assert not dominates((1000, 3, 1), (1000, 3, 1))
    assert not dominates((1000, 4, 1), (1100, 3, 2))


def test_identical_vectors_are_both_on_frontier():
    frontier, dominated = pareto_frontier({"B": (1000, 3, 1), "A": (1000, 3, 1)})
    assert frontier == ["A", "B"]
    assert dominated == {}


def test_three_way_tradeoff_and_dominated_example():
    frontier, dominated = pareto_frontier({
        "cheap": (1000, 8, 3),
        "work": (1500, 1, 3),
        "station": (1500, 8, 0.2),
        "dominated": (1600, 9, 4),
    })
    assert frontier == ["cheap", "station", "work"]
    assert dominated["dominated"] == "cheap"


@pytest.mark.parametrize("bad", [(None, 1, 2), (float("nan"), 1, 2), (1, 2)])
def test_missing_or_malformed_pareto_objectives_are_rejected(bad):
    with pytest.raises(ValueError, match="three finite"):
        dominates(bad, (1, 2, 3))
