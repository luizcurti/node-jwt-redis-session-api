import { ConflictError } from '../../../errors/AppError';
import { UserRepository } from '../../../repositories/UserRepository';
import {
  resetDatabase,
  testPool,
  closeTestConnections,
} from '../../testSetup/testDb';

describe('UserRepository (integration)', () => {
  const repository = new UserRepository(testPool);

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  it('creates a user and finds it by username', async () => {
    await repository.create({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Test User',
      username: 'integrationuser',
      passwordHash: 'hashed-password',
      email: 'integration@example.com',
    });

    const found = await repository.findByUsername('integrationuser');

    expect(found).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Test User',
      username: 'integrationuser',
      password: 'hashed-password',
      email: 'integration@example.com',
      role: 'user',
    });
  });

  it('returns null when the username does not exist', async () => {
    const found = await repository.findByUsername('does-not-exist');

    expect(found).toBeNull();
  });

  it('reports existsByUsername correctly before and after creation', async () => {
    await expect(repository.existsByUsername('integrationuser')).resolves.toBe(
      false
    );

    await repository.create({
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Test User',
      username: 'integrationuser',
      passwordHash: 'hashed-password',
      email: 'integration2@example.com',
    });

    await expect(repository.existsByUsername('integrationuser')).resolves.toBe(
      true
    );
  });

  it('reports existsByEmail correctly before and after creation', async () => {
    await expect(
      repository.existsByEmail('integration@example.com')
    ).resolves.toBe(false);

    await repository.create({
      id: '55555555-5555-5555-5555-555555555555',
      name: 'Test User',
      username: 'emailcheckuser',
      passwordHash: 'hashed-password',
      email: 'integration@example.com',
    });

    await expect(
      repository.existsByEmail('integration@example.com')
    ).resolves.toBe(true);
  });

  it('rejects a second user with a duplicate username as a clean ConflictError', async () => {
    await repository.create({
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Test User',
      username: 'duplicateuser',
      passwordHash: 'hashed-password',
      email: 'first@example.com',
    });

    await expect(
      repository.create({
        id: '44444444-4444-4444-4444-444444444444',
        name: 'Another User',
        username: 'duplicateuser',
        passwordHash: 'hashed-password',
        email: 'second@example.com',
      })
    ).rejects.toThrow(ConflictError);
  });

  it('rejects a second user with a duplicate email as a clean ConflictError', async () => {
    await repository.create({
      id: '66666666-6666-6666-6666-666666666666',
      name: 'Test User',
      username: 'emailuser1',
      passwordHash: 'hashed-password',
      email: 'duplicate@example.com',
    });

    await expect(
      repository.create({
        id: '77777777-7777-7777-7777-777777777777',
        name: 'Another User',
        username: 'emailuser2',
        passwordHash: 'hashed-password',
        email: 'duplicate@example.com',
      })
    ).rejects.toThrow(ConflictError);
  });

  it('closes the TOCTOU race: only one of two concurrent inserts for the same username succeeds', async () => {
    const attemptA = repository.create({
      id: '88888888-8888-8888-8888-888888888888',
      name: 'Racer A',
      username: 'racecondition',
      passwordHash: 'hashed-password',
      email: 'racer-a@example.com',
    });
    const attemptB = repository.create({
      id: '99999999-9999-9999-9999-999999999999',
      name: 'Racer B',
      username: 'racecondition',
      passwordHash: 'hashed-password',
      email: 'racer-b@example.com',
    });

    const results = await Promise.allSettled([attemptA, attemptB]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError
    );
  });

  it('closes the TOCTOU race: only one of two concurrent inserts for the same email succeeds', async () => {
    const attemptA = repository.create({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'Racer A',
      username: 'emailracera',
      passwordHash: 'hashed-password',
      email: 'race-condition@example.com',
    });
    const attemptB = repository.create({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      name: 'Racer B',
      username: 'emailracerb',
      passwordHash: 'hashed-password',
      email: 'race-condition@example.com',
    });

    const results = await Promise.allSettled([attemptA, attemptB]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError
    );
  });

  it('always defaults a newly created user to the "user" role, regardless of what create() is given', async () => {
    // NewUser has no `role` field at all — there is no code path through
    // this repository that lets a caller (or, transitively, a public
    // signup request body) assign a role at creation time. This is what
    // makes that structurally true, not just validated away.
    await repository.create({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      name: 'Default Role User',
      username: 'defaultroleuser',
      passwordHash: 'hashed-password',
      email: 'defaultrole@example.com',
    });

    const found = await repository.findByUsername('defaultroleuser');

    expect(found?.role).toBe('user');
  });

  describe('listPaginated', () => {
    it('paginates and counts real rows', async () => {
      await repository.create({
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        name: 'Page User 1',
        username: 'pageuser1',
        passwordHash: 'hashed-password',
        email: 'pageuser1@example.com',
      });
      await repository.create({
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        name: 'Page User 2',
        username: 'pageuser2',
        passwordHash: 'hashed-password',
        email: 'pageuser2@example.com',
      });

      const firstPage = await repository.listPaginated(1, 0);
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.total).toBe(2);

      const secondPage = await repository.listPaginated(1, 1);
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);

      const emptyPage = await repository.listPaginated(1, 2);
      expect(emptyPage.items).toHaveLength(0);
      expect(emptyPage.total).toBe(2);
    });
  });
});
