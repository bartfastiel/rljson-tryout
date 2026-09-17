/**
 * The lower-case, hyphenated form of a name, the shape every hand-written
 * seed id has (`grandma-ducks-farm` for "Grandma Duck's Farm"): apostrophes
 * vanish, every other run of characters that is not a letter or a digit
 * becomes one hyphen, and no hyphen leads or trails.
 */
export const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replaceAll("'", '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

/**
 * The id of a generated row: the slug of its name followed by its running
 * number within its table (`goose-1`, `della-featherby-17`), so that two
 * generated rows with the same name still get distinct ids and no
 * generated id can collide with a hand-written one, which never ends in a
 * number.
 */
export const generatedId = (name: string, number: number): string =>
  `${slugOf(name)}-${number}`;
