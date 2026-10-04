import type { User, UserRole } from '@/types';
export function testUser(id='seller-a',role:UserRole='seller'):User {
  return {id,role,email:`${id}@example.com`,name:id,createdAt:'2026-01-01T00:00:00.000Z',lastLoginAt:'2026-01-01T00:00:00.000Z',emailVerified:true};
}
