// Your Supabase project's address and public key.
// Find both in Supabase > Project Settings > API (or Data API).
// The "anon public" key is meant to be public: the database rules in supabase/setup.sql decide what anyone can do.
// NEVER put the "service_role" / secret key here.
window.MNQ_CONFIG = {
  supabaseUrl: "https://awpyovkucwteyzsqcazl.supabase.co",
  supabaseAnonKey: "sb_publishable_os6M-4IwXTuKMG6hhnwFPw_pSJHkrK1",
  // Public key for reminder notifications (public by design; its private half is only in Supabase's secrets).
  vapidPublicKey: "BAgcDXmc-vtf4eApgX3oACHFjXZpeVZnxJBiU7U86Z2SWKbAzkmJlUeRp1hfC9-pDUZVmF40TmWpZtbsBeVRJeY",
  // Shown on the Privacy policy and Terms pages. Fill in before launch.
  contactEmail: "",
};
