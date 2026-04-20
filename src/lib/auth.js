export const TEST_ACCOUNTS = [
  { username: "Caregiver1", password: "123456", caregiverId: 1 },
  { username: "Caregiver2", password: "123456", caregiverId: 2 },
  { username: "Caregiver3", password: "123456", caregiverId: 3 },
  { username: "Caregiver4", password: "123456", caregiverId: 4 },
  { username: "Caregiver5", password: "123456", caregiverId: 5 },
];

export function findAccount(username, password) {
  return (
    TEST_ACCOUNTS.find(
      (account) => account.username === username.trim() && account.password === password
    ) || null
  );
}
