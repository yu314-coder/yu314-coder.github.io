"""One exit code that means "the archive refused us", not "this script is broken".

These pipelines depend on a public archive that periodically closes a dataset
to everyone. When that happens there is nothing to fix here and nothing to
retry around, so a red run every hour is pure noise -- the same message, over
and over, for a condition already known and outside our control. Worse, it
trains you to ignore the failures that do matter.

So a refusal exits with EX_TEMPFAIL and the workflow turns that into a warning
annotation and a green run. Anything else -- a bad path, a schema change, a
genuine bug -- still fails loudly, because those are ours to fix.

The distinction is deliberately narrow: only an explicit refusal from upstream
counts. "No data came back" does not, because that is how an archive quietly
going stale looks, and that must stay loud.
"""

import sys

BLOCKED = 75          # EX_TEMPFAIL: upstream said no; try again later


def blocked(what, detail, url=None):
    """Report an upstream refusal and exit so the workflow can go green."""
    print(f"::warning title=Upstream refused::{what}: {detail}"
          + (f" ({url})" if url else ""), flush=True)
    print(f"\nUPSTREAM REFUSED -- {what}\n  {detail}"
          + (f"\n  {url}" if url else "")
          + "\n  Nothing to fix here and nothing to retry; this run is green on purpose so\n"
            "  the same message does not arrive again every hour. It will pick up by\n"
            "  itself once the archive answers.", file=sys.stderr, flush=True)
    raise SystemExit(BLOCKED)
