import { generateUUID } from '../lib/utils';

describe('generateUUID', () => {
  it('gera um UUID válido', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/[0-9a-fA-F\-]{36}/);
  });
});
