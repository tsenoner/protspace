/**
 * A path of the machine that ran a build, as it can appear in a build command: a scratch, home,
 * macOS temporary or mounted-volume directory, or a `~/` path, at the start of the command or
 * after whitespace, `=` or an opening quote (a shell-quoted path with a space starts with one).
 *
 * `generate-examples.mts` refuses a manifest build command that names one, because the docs page
 * prints the command and the bundle publishes it; `build_command` in `build_showcase.py` writes
 * placeholders such as `--cli-root $CLI` instead.
 */
export const MACHINE_PATH =
  /(^|[\s='"])(\/private\/|\/tmp\/|\/var\/folders\/|\/Users\/|\/home\/|\/Volumes\/|~\/)/;
