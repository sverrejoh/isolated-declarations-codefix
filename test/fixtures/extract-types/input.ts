// Scenario 1: Variable with large inferred type (6 members -> extract)
function getConfig() {
  return { host: "localhost", port: 3000, debug: false, timeout: 5000, retries: 3, logLevel: "info" };
}
export const config = getConfig();

// Scenario 2: Function return with large type (6 members -> extract)
export function createUser(id: number, name: string) {
  return { id, name, email: name + "@test.com", active: true, role: "user", createdAt: 0 };
}

// Scenario 3: Arrow function with large return type (6 members -> extract)
export const getSettings = () => {
  return { theme: "dark", language: "en", fontSize: 14, sidebar: true, notifications: true, autoSave: false };
};

// Scenario 4: Small type — should NOT be extracted (3 members <= 5)
export function getPoint() { return { x: 1, y: 2, z: 3 }; }

// Scenario 5: Class method with large return type (6 members -> extract)
export class UserService {
  getUser(id: number) {
    return { id, name: "test", email: "t@t.com", active: true, role: "admin", permissions: ["read"] };
  }
}

// Scenario 6: Function expression assigned to const (6 members -> extract)
export const buildResponse = function(code: number) {
  return { code, message: "ok", timestamp: 0, success: true, data: "payload", version: "1.0" };
};
