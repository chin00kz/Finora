import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://sjmwvbajuutsvwgqlayc.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqbXd2YmFqdXV0c3Z3Z3FsYXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4Mjc5NzYsImV4cCI6MjEwMzQwMzk3Nn0.Mzz3rKppGkVhx050ctJri8WKYSmc2eagnk-mBMAX4_Q';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

