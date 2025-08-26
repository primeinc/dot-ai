/**
 * Tests for Project Scope Resolver
 */

import { resolveProjectKey } from '../../src/core/project-scope-resolver';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock child_process and fs
jest.mock('child_process');
jest.mock('fs');

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

describe('Project Scope Resolver', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Create temp directory path for testing
    tempDir = path.join(os.tmpdir(), 'test-project-scope');
    
    // Clear all mocks
    jest.clearAllMocks();
    
    // Default mock - no Git repo found
    mockExecSync.mockImplementation(() => {
      throw new Error('Not a git repository');
    });
    
    // Default mock - no marker files found
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
  });

  describe('Environment Variable Override', () => {
    it('should use DOTAI_PROJECT_KEY when set', () => {
      process.env.DOTAI_PROJECT_KEY = 'my-custom-project';
      
      const result = resolveProjectKey(tempDir);
      
      expect(result).toBe('my-custom-project');
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('should sanitize DOTAI_PROJECT_KEY value', () => {
      process.env.DOTAI_PROJECT_KEY = 'My Custom Project!@#$%';
      
      const result = resolveProjectKey(tempDir);
      
      expect(result).toBe('my-custom-project');
    });

    it('should ignore empty DOTAI_PROJECT_KEY', () => {
      process.env.DOTAI_PROJECT_KEY = '   ';
      
      // Should fallback to directory-based approach
      const result = resolveProjectKey(tempDir);
      
      expect(result).toMatch(/test-project-scope-[a-f0-9]{8}/);
    });
  });

  describe('Git Repository Detection', () => {
    it('should parse SSH remote URL', () => {
      mockExecSync
        .mockReturnValueOnce('/repo/root')  // git rev-parse --show-toplevel
        .mockReturnValueOnce('git@github.com:owner/repo.git'); // git config --get remote.origin.url
      
      const result = resolveProjectKey('/repo/root');
      
      expect(result).toBe('owner-repo');
    });

    it('should parse HTTPS remote URL', () => {
      mockExecSync
        .mockReturnValueOnce('/repo/root')
        .mockReturnValueOnce('https://github.com/owner/repo.git');
      
      const result = resolveProjectKey('/repo/root');
      
      expect(result).toBe('owner-repo');
    });

    it('should parse HTTPS remote URL without .git suffix', () => {
      mockExecSync
        .mockReturnValueOnce('/repo/root')
        .mockReturnValueOnce('https://github.com/owner/repo');
      
      const result = resolveProjectKey('/repo/root');
      
      expect(result).toBe('owner-repo');
    });

    it('should handle git+ prefix in URLs', () => {
      mockExecSync
        .mockReturnValueOnce('/repo/root')
        .mockReturnValueOnce('git+https://github.com/owner/repo.git');
      
      const result = resolveProjectKey('/repo/root');
      
      expect(result).toBe('owner-repo');
    });

    it('should sanitize owner and repo names', () => {
      mockExecSync
        .mockReturnValueOnce('/repo/root')
        .mockReturnValueOnce('git@github.com:My-Org_123/My.Repo-456.git');
      
      const result = resolveProjectKey('/repo/root');
      
      expect(result).toBe('my-org_123-my.repo-456');
    });
  });

  describe('Monorepo Subproject Detection', () => {
    beforeEach(() => {
      // Mock successful Git repo detection
      mockExecSync
        .mockReturnValueOnce('/repo/root')
        .mockReturnValueOnce('git@github.com:owner/repo.git');
    });

    it('should detect package.json marker', () => {
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        return filePath.toString() === '/repo/root/packages/api/package.json';
      });
      
      const result = resolveProjectKey('/repo/root/packages/api');
      
      expect(result).toBe('owner-repo--packages-api');
    });

    it('should detect go.mod marker', () => {
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        return filePath.toString() === '/repo/root/services/auth/go.mod';
      });
      
      const result = resolveProjectKey('/repo/root/services/auth');
      
      expect(result).toBe('owner-repo--services-auth');
    });

    it('should detect pyproject.toml marker', () => {
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        return filePath.toString() === '/repo/root/python-service/pyproject.toml';
      });
      
      const result = resolveProjectKey('/repo/root/python-service');
      
      expect(result).toBe('owner-repo--python-service');
    });

    it('should detect Cargo.toml marker', () => {
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        return filePath.toString() === '/repo/root/rust-app/Cargo.toml';
      });
      
      const result = resolveProjectKey('/repo/root/rust-app');
      
      expect(result).toBe('owner-repo--rust-app');
    });

    it('should use closest marker to current directory', () => {
      mockExistsSync.mockImplementation((filePath: fs.PathLike) => {
        const pathStr = filePath.toString();
        return pathStr === '/repo/root/packages/api/package.json' || 
               pathStr === '/repo/root/package.json';
      });
      
      const result = resolveProjectKey('/repo/root/packages/api');
      
      // Should use the closer package.json, not the root one
      expect(result).toBe('owner-repo--packages-api');
    });

    it('should fallback to directory-based suffix when no marker found', () => {
      mockExistsSync.mockReturnValue(false);
      
      const result = resolveProjectKey('/repo/root/packages/frontend');
      
      expect(result).toBe('owner-repo--packages');
    });

    it('should handle repo root with no subproject', () => {
      mockExistsSync.mockReturnValue(false);
      
      const result = resolveProjectKey('/repo/root');
      
      expect(result).toBe('owner-repo');
    });
  });

  describe('Fallback Behavior', () => {
    it('should create stable key from directory path when Git unavailable', () => {
      const testDir = '/some/project/directory';
      
      const result = resolveProjectKey(testDir);
      
      expect(result).toMatch(/directory-[a-f0-9]{8}/);
      
      // Should be deterministic
      const result2 = resolveProjectKey(testDir);
      expect(result2).toBe(result);
    });

    it('should handle workspace as default directory name', () => {
      const result = resolveProjectKey('');
      
      expect(result).toMatch(/workspace-[a-f0-9]{8}/);
    });

    it('should sanitize directory names in fallback', () => {
      const testDir = '/path/to/My Project Dir!@#';
      
      const result = resolveProjectKey(testDir);
      
      expect(result).toMatch(/my-project-dir-[a-f0-9]{8}/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed Git remote URLs', () => {
      mockExecSync
        .mockReturnValueOnce('/repo/root')
        .mockReturnValueOnce('not-a-valid-url');
      
      const result = resolveProjectKey('/repo/root');
      
      // Should fallback to directory-based approach
      expect(result).toMatch(/root-[a-f0-9]{8}/);
    });

    it('should handle Git commands that return empty output', () => {
      mockExecSync
        .mockReturnValueOnce('')  // Empty git rev-parse output
        .mockReturnValueOnce('git@github.com:owner/repo.git');
      
      const result = resolveProjectKey('/some/dir');
      
      // Should fallback since repo root is empty
      expect(result).toMatch(/dir-[a-f0-9]{8}/);
    });

    it('should handle remote URLs with unusual formats', () => {
      mockExecSync
        .mockReturnValueOnce('/repo/root')
        .mockReturnValueOnce('https://custom-git-server.com/org/project.git');
      
      const result = resolveProjectKey('/repo/root');
      
      expect(result).toBe('org-project');
    });
  });

  describe('Integration with current working directory', () => {
    it('should use process.cwd() when no path provided', () => {
      const originalCwd = process.cwd();
      
      // Mock process.cwd() to return our test directory
      const spy = jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
      
      const result = resolveProjectKey();
      
      expect(result).toMatch(/test-project-scope-[a-f0-9]{8}/);
      
      spy.mockRestore();
    });
  });
});