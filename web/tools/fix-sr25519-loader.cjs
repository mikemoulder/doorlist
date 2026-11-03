// Webpack loader for @scure/sr25519 (used by polkadot.js for sr25519 keys).
// Its source has `proving${'\0'}0`. Next's SWC minifier folds that into the template literal as `proving\00`,
// an octal escape, which is a SyntaxError in template strings: the browser refuses the chunk and webpack
// reports "Loading chunk N failed (missing)" when signing in with a Portaldot (5...) account.
// Rewriting it as a plain string with a hex escape keeps the same bytes ("proving", NUL, "0") and minifies safely.
module.exports = function fixSr25519(source) {
  const from = "`proving${'\\0'}0`";
  const to = "'proving\\x000'";
  if (!source.includes(from)) return source;
  return source.split(from).join(to);
};
