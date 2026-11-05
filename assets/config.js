/* Where the app's content, sign-in and records live (Supabase).
   This key is the public "anon" key: it is meant to be in the app. It can only call the functions
   in supabase/migrations, which check each staff member's sign-in. It cannot read any table directly. */
window.AB_CONFIG = {
  url: "https://xzyzovlmlppvctbpxnrw.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6eXpvdmxtbHBwdmN0YnB4bnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4NjAwODksImV4cCI6MjEwOTQzNjA4OX0.CS1z2VvWfyoXh3zTije1mubxYsnpLEYozontUyoZNMg"
};
