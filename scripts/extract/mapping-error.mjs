/** A failure to map source rows to canonical records that must not be guessed past. */
export class MappingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MappingError';
    this.code = code;
    this.details = details;
  }
}
