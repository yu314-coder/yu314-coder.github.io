// Builds assets/vendor/bootstrap-5.3.3/bootstrap.site.min.css — the part of
// Bootstrap 5.3.3 this site actually uses (about 31 KB of the 227 KB file).
// Every page links the subset; bootstrap.min.css stays as the untouched source.
//
// Rebuild from the repo root after adding a Bootstrap class to any page or script:
//   npx -y purgecss@6.0.0 --config scripts/purgecss.bootstrap.cjs
// The bootstrap-subset workflow runs the same command on every push and commits
// the result if it changed, so a new class can't stay unstyled for long.
//
// PurgeCSS keeps a selector only if each class, id and tag in it appears as a
// word somewhere in `content`, so a class assembled at runtime ("btn-" + tone)
// must be spelled out in full somewhere or safelisted below.
module.exports = {
  content: [
    '*.html',
    'assets/js/**/*.js',
    'assets/*-tracker/**/*.js',
    'assets/*-tracker/*.html',
  ],
  css: ['assets/vendor/bootstrap-5.3.3/bootstrap.min.css'],
  output: 'assets/vendor/bootstrap-5.3.3/bootstrap.site.min.css',
  safelist: {
    // Added by Bootstrap's own JS (navbar collapse, project tabs) and by form validation.
    standard: ['show', 'showing', 'hiding', 'collapsing', 'collapse', 'collapse-horizontal', 'fade',
               'active', 'disabled', 'was-validated', 'is-valid', 'is-invalid', 'valid-feedback',
               'invalid-feedback'],
    greedy: [/^navbar/, /^nav-/, /^tab-/],
  },
  variables: true,
  keyframes: true,
  fontFace: true,
};
