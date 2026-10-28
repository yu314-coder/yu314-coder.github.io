#!/bin/bash
# Builds the CSS the pages link. Run it after editing a page or a stylesheet; the
# rebuild-css workflow also runs it on every push that touches one, and commits the result.
#
#   assets/vendor/bootstrap-5.3.3/bootstrap.site.min.css   the Bootstrap rules the pages use
#                                                          (scripts/purgecss.bootstrap.cjs)
#   assets/css/style.min.css                               assets/css/style.css minified by csso with
#                                                          --no-restructure: whitespace and comments only,
#                                                          no rule merging, so the cascade is untouched.
#                                                          26 KB -> 14 KB gzipped (2026-10-29), checked
#                                                          pixel for pixel on every page.
#
# and stamps every page's link to style.min.css with a hash of its content, so a browser
# fetches the new file exactly when it changes. Edit style.css, never style.min.css.
set -euo pipefail
cd "$(dirname "$0")/.."

npx -y purgecss@6.0.0 --config scripts/purgecss.bootstrap.cjs
npx -y csso-cli@4.0.2 --no-restructure assets/css/style.css -o assets/css/style.min.css

H=$(shasum -a 1 assets/css/style.min.css | cut -c1-8)
for f in *.html; do
  sed -i.bak -E "s#(assets/css/style)(\.min)?\.css(\?v=[A-Za-z0-9._-]+)?\"#\1.min.css?v=$H\"#g" "$f"
  rm -f "$f.bak"
done
echo "style.min.css $(wc -c < assets/css/style.min.css) bytes, v=$H"
