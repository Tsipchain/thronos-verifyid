import { apiClient } from './api';

export interface Permission {
  id: number;
  name: string;
  resource: string;
  action: string;
  description?: string;
}

export interface Role {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

export interface UserPermissions {
  user_id: string;
  roles: Role[];
  permissions: Permission[];
}

class RBACManager {
  private permissions: Permission[] = [];
  private roles: Role[] = [];
  private initialized = false;

  async initialize() {
    if (this.initialized) return;
    
    try {
      const response = await apiClient.get('/api/v1/rbac/me/permissions');

      this.permissions = response.data.permissions ?? [];
      this.roles = response.data.roles ?? [];
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize RBAC:', error);
      throw error;
    }
  }

  hasPermission(resource: string, action: string): boolean {
    return this.permissions.some(
      p => p.resource === resource && p.action === action
    );
  }

  hasRole(roleName: string): boolean {
    return this.roles.some(r => r.name === roleName);
  }

  getRoles(): Role[] {
    return this.roles;
  }

  getPermissions(): Permission[] {
    return this.permissions;
  }

  canAccessVerifications(): boolean {
    return this.hasPermission('verifications', 'read');
  }

  canCreateVerifications(): boolean {
    return this.hasPermission('verifications', 'create');
  }

  canUpdateVerifications(): boolean {
    return this.hasPermission('verifications', 'update');
  }

  canDeleteVerifications(): boolean {
    return this.hasPermission('verifications', 'delete');
  }

  canAccessChat(): boolean {
    return this.hasPermission('chat', 'read');
  }

  canSendMessages(): boolean {
    return this.hasPermission('chat', 'send');
  }

  canManageChat(): boolean {
    return this.hasPermission('chat', 'manage');
  }

  canAccessUsers(): boolean {
    return this.hasPermission('users', 'read');
  }

  canManageUsers(): boolean {
    return this.hasPermission('users', 'manage');
  }

  canAccessSettings(): boolean {
    return this.hasPermission('settings', 'read');
  }

  canManageSettings(): boolean {
    return this.hasPermission('settings', 'manage');
  }

  canAccessReports(): boolean {
    return this.hasPermission('reports', 'read');
  }

  isKYCAgent(): boolean {
    return this.hasRole('kyc_agent') || this.hasRole('agent');
  }

  isITStaff(): boolean {
    return this.hasRole('it_staff');
  }

  isManagement(): boolean {
    return this.hasRole('management') || this.hasRole('manager');
  }

  isAdmin(): boolean {
    return this.hasRole('admin');
  }
}

export const rbac = new RBACManager();
