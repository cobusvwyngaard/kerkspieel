"""Two checks every report needs before it draws a question.

Both exist because a question's *label* and its *column* are resolved
separately -- the label from the questionnaire, the column from the
extract -- and where they come apart, the chart is silently wrong rather
than visibly broken.
"""

import collections

# A count that never exceeds this, over hundreds of answers, and takes only
# a handful of distinct values, is a response code rather than a quantity.
CODE_CEILING = 6
# Fewer answers than this and the evidence is too thin to judge either way.
MIN_EVIDENCE = 100
# Below this share of answers inside a question's own option list, the
# column is not the question the codebook says it is.
IN_RANGE = 0.9
# A scale of three or more options that records nothing but 1 and 2, over
# hundreds of answers, is a Ja/Nee column wearing the wrong labels.
BINARY_EVIDENCE = 100


def values_by_question(responses):
    """qid -> every non-null value, and (qid, wave) -> the same per wave."""
    whole, per_wave = collections.defaultdict(list), collections.defaultdict(list)
    for row in responses:
        for qid, value in row["values"].items():
            if value is None:
                continue
            whole[qid].append(value)
            per_wave[(qid, row["wave"])].append(value)
    return whole, per_wave


def unparsed_scales(numeric, responses, values=None):
    """Questions filed as counts whose values are plainly option codes.

    A question with no option list parsed out of the questionnaire is filed
    as numeric. Some of those are grids -- "Altyd / Soms / Nooit" -- whose
    header the questionnaire parser did not pick up. A mean of 1.8 over an
    Altyd/Soms/Nooit code is meaningless, and a pin sized by it says
    nothing, so they are held back until their options are parsed.
    """
    if values is None:
        values, _ = values_by_question(responses)
    coded = set()
    for q in numeric:
        seen = [v for v in values.get(q["id"], []) if isinstance(v, (int, float))]
        distinct = set(seen)
        # A response code runs 1..n; a count of things reaches zero, and a
        # question where no congregation has none is not asking for a count.
        if (len(seen) >= MIN_EVIDENCE and distinct and min(distinct) >= 1
                and max(distinct) <= CODE_CEILING
                and len(distinct) <= CODE_CEILING):
            coded.add(q["id"])
    return coded


def suspect_scales(offered, responses, per_wave=None):
    """Question-waves whose values contradict the scale they are labelled with.

    This caught the case it was written for -- seven questions carrying the
    hospitality grid's labels over the catechesis grid's columns, because
    KS_lookup's labels were keyed by whichever wave's code a row happened to
    have. That is fixed at the source now, in build_crosswalk.py, and this
    stays as the check that would catch the next one.
    """
    if per_wave is None:
        _, per_wave = values_by_question(responses)
    flagged = {}
    for q in offered:
        for wave, options in q["options"].items():
            if not options:
                continue
            values = per_wave.get((q["id"], wave), [])
            if not values:
                continue
            allowed = {o["value"] for o in options}
            inside = [v for v in values if v in allowed]
            share = len(inside) / len(values)
            if share < IN_RANGE:
                flagged[(q["id"], wave)] = (
                    f"only {share:.0%} of {len(values)} answers are among its "
                    f"{len(options)} options")
            elif (len(options) >= 3 and len(inside) >= BINARY_EVIDENCE
                  and set(inside) <= {1, 2}):
                flagged[(q["id"], wave)] = (
                    f"{len(options)} options offered, but {len(inside)} answers "
                    f"use only 1 and 2 -- a Ja/Nee column")
    return flagged
