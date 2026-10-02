import { useEffect, type ReactNode } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useAuth } from "./lib/auth";
import { AppShell } from "./components/AppShell";
import { FullScreenLoader } from "./components/ui";
import { SignInPage } from "./features/auth/SignInPage";
import { RegisterPage } from "./features/auth/RegisterPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { NewTeamPage } from "./features/teams/NewTeamPage";
import { TeamPage } from "./features/teams/TeamPage";
import {
  EditWorkoutPage,
  NewWorkoutPage,
} from "./features/workouts/WorkoutBuilderPage";
import { WorkoutDetailPage } from "./features/workouts/WorkoutDetailPage";
import { PersonalCalendarPage } from "./features/calendar/PersonalCalendar";
import { InviteAcceptPage } from "./features/invitations/InviteAcceptPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import {
  EditActivityPage,
  NewActivityPage,
} from "./features/activities/ActivityFormPage";
import { ActivityDetailPage } from "./features/activities/ActivityDetailPage";
import { AthletePage } from "./features/athletes/AthletePage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) {
    return (
      <Navigate
        to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }
  return <>{children}</>;
}

function GuestRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <p className="text-6xl font-black text-ink-700">404</p>
      <p className="mt-2 text-mist">This trail doesn't exist.</p>
      <a
        href="/dashboard"
        className="mt-4 font-bold text-volt-300 hover:text-volt-400"
      >
        Back to dashboard
      </a>
    </div>
  );
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Public invitation flow — no shell, no auth required to view */}
        <Route path="/invite/:token" element={<InviteAcceptPage />} />

        {/* Guest-only auth screens */}
        <Route
          path="/signin"
          element={
            <GuestRoute>
              <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
                <SignInPage />
              </div>
            </GuestRoute>
          }
        />
        <Route
          path="/register"
          element={
            <GuestRoute>
              <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
                <RegisterPage />
              </div>
            </GuestRoute>
          }
        />

        {/* Authenticated app */}
        <Route element={<AppShell />}>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teams/new"
            element={
              <ProtectedRoute>
                <NewTeamPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teams/:id"
            element={
              <ProtectedRoute>
                <TeamPage initialTab="roster" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teams/:id/workouts"
            element={
              <ProtectedRoute>
                <TeamPage initialTab="workouts" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teams/:id/workouts/new"
            element={
              <ProtectedRoute>
                <NewWorkoutPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teams/:id/groups"
            element={
              <ProtectedRoute>
                <TeamPage initialTab="groups" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teams/:id/calendar"
            element={
              <ProtectedRoute>
                <TeamPage initialTab="calendar" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workouts/:workoutId"
            element={
              <ProtectedRoute>
                <WorkoutDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workouts/:workoutId/edit"
            element={
              <ProtectedRoute>
                <EditWorkoutPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/calendar"
            element={
              <ProtectedRoute>
                <PersonalCalendarPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities/new"
            element={
              <ProtectedRoute>
                <NewActivityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities/:id"
            element={
              <ProtectedRoute>
                <ActivityDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activities/:id/edit"
            element={
              <ProtectedRoute>
                <EditActivityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teams/:id/athletes/:userId"
            element={
              <ProtectedRoute>
                <AthletePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
