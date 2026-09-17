/**
 * What an edit of an animal may change, and what makes such an edit
 * invalid. This is the body of `PUT /api/animals/:id` (roadmap section
 * 2.5): any subset of the editable fields, applied on top of the animal's
 * current version to produce a new one. References are given by stable
 * `id` (`speciesId`, `breederId`, `traitIds`) and resolved to the current
 * version's hash by the store, never by hash from the outside.
 */
export type AnimalChanges = {
  name?: string;
  priceCents?: number;
  bornOn?: string;
  backgroundStory?: string;
  speciesId?: string;
  breederId?: string;
  traitIds?: string[];
};

/**
 * The fields an edit may name, in the order the edit form shows them.
 */
export const editableAnimalFields = [
  'name',
  'speciesId',
  'breederId',
  'bornOn',
  'priceCents',
  'backgroundStory',
  'traitIds',
] as const;

const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Every reason the given changes cannot be applied, as sentences written
 * for the person who filled in the form, an empty list when the changes
 * are valid. Checks the shape alone: a field that is not editable, no
 * field at all, an empty name, a price that is not a whole non-negative
 * number of cents, a birth date that is not a calendar date, a story that
 * is not text, a species or breeder id that is empty, a trait list that
 * is not a list of distinct ids. Whether a named species, breeder or trait
 * exists is the store's question, since only the store holds the rows.
 */
export const animalChangeProblems = (
  changes: Readonly<Record<string, unknown>>,
): string[] => {
  const problems: string[] = [];
  const fields = Object.keys(changes);
  const editable: readonly string[] = editableAnimalFields;

  if (fields.length === 0) {
    return ['The request names no editable field.'];
  }
  for (const field of fields) {
    if (!editable.includes(field)) {
      problems.push(
        `"${field}" is not an editable field of an animal; editable fields are ${editable.join(', ')}.`,
      );
    }
  }
  if ('name' in changes && !isNonEmptyString(changes.name)) {
    problems.push('The name must not be empty.');
  }
  if (
    'priceCents' in changes &&
    (!Number.isInteger(changes.priceCents) ||
      (changes.priceCents as number) < 0)
  ) {
    problems.push('The price must be a whole number of cents, at least 0.');
  }
  if (
    'bornOn' in changes &&
    (typeof changes.bornOn !== 'string' || !isCalendarDate(changes.bornOn))
  ) {
    problems.push('The birth date must be a calendar date such as 2024-05-31.');
  }
  if (
    'backgroundStory' in changes &&
    typeof changes.backgroundStory !== 'string'
  ) {
    problems.push('The background story must be text.');
  }
  if ('speciesId' in changes && !isNonEmptyString(changes.speciesId)) {
    problems.push('The species id must not be empty.');
  }
  if ('breederId' in changes && !isNonEmptyString(changes.breederId)) {
    problems.push('The breeder id must not be empty.');
  }
  if ('traitIds' in changes) {
    const traitIds = changes.traitIds;
    if (!Array.isArray(traitIds) || !traitIds.every(isNonEmptyString)) {
      problems.push('The traits must be a list of trait ids.');
    } else if (new Set(traitIds).size !== traitIds.length) {
      problems.push('The traits must not repeat a trait id.');
    }
  }

  return problems;
};

/**
 * The `id` of the change set that wrote a new animal version, named after
 * the operation and the version's InsertHistory `timeId`, which is unique
 * per write on a node, so that repeated edits of one animal get change
 * sets of their own that read in edit order in a table dump.
 */
export const updateAnimalChangeSetId = (
  animalId: string,
  timeId: string,
): string => `update-animal-${animalId}-${timeId}`;
