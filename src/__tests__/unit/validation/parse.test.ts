import { z } from 'zod';
import { ValidationError } from '../../../errors/AppError';
import { parseOrThrow } from '../../../validation/parse';

describe('parseOrThrow', () => {
  const schema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters.'),
  });

  it('returns the parsed value when the input is valid', () => {
    expect(parseOrThrow(schema, { name: 'Alice' })).toEqual({ name: 'Alice' });
  });

  it('throws ValidationError with the first issue message when invalid', () => {
    expect(() => parseOrThrow(schema, { name: 'A' })).toThrow(ValidationError);
    expect(() => parseOrThrow(schema, { name: 'A' })).toThrow(
      'Name must be at least 2 characters.'
    );
  });
});
