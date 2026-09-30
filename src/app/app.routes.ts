import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

const list = () => import('./pages/authorization-list/authorization-list.page').then((m) => m.AuthorizationListPage);

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'authorizations' },
  { path: 'dashboard', redirectTo: 'authorizations' },
  { path: 'login', title: 'Sign in · AuthBridge', loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage) },
  { path: 'authorizations', title: 'Requests · AuthBridge', canActivate: [authGuard], loadComponent: list, data: { mode: 'requests' } },
  { path: 'submissions', title: 'Submissions · AuthBridge', canActivate: [authGuard], loadComponent: list, data: { mode: 'submissions' } },
  {
    path: 'activity',
    title: 'Activity · AuthBridge',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/activity/activity.page').then((m) => m.ActivityPage),
  },
  {
    path: 'authorizations/:id',
    title: 'Request · AuthBridge',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/authorization-detail/authorization-detail.page').then((m) => m.AuthorizationDetailPage),
  },
  {
    path: 'proposals/:id',
    title: 'Review · AuthBridge',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/proposal-review/proposal-review.page').then((m) => m.ProposalReviewPage),
  },
  {
    path: 'submissions/:id',
    title: 'Submission · AuthBridge',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/submission-progress/submission-progress.page').then((m) => m.SubmissionProgressPage),
  },
  { path: '**', redirectTo: 'authorizations' },
];
