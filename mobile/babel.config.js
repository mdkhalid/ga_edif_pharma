/**
 * Babel config.
 *
 * `babel-preset-expo` is the only preset needed: it enables the React Compiler-
 * compatible JSX transform, the Reanimated/Metro plugins when those packages are
 * present, and the platform-specific resolvers. `api.cache(true)` lets Metro cache
 * the compiled output across runs.
 *
 * There is deliberately no `babel-plugin-module-resolver` here. That plugin is what
 * most projects add to support `@/…` path aliases, and it is a common source of
 * "works in Metro, fails in Jest" confusion. The app uses relative imports instead,
 * so there is exactly one module-resolution story.
 */
module.exports = function babelConfig(api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
  };
};
