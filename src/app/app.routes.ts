import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'login', title: 'Sign in · AuthBridge', loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage) },
  {
    path: 'dashboard',
    title: 'Dashboard · AuthBridge',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  {
    path: 'authorizations',
    title: 'Requests · AuthBridge',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/authorization-list/authorization-list.page').then((m) => m.AuthorizationListPage),
  },
  {
    path: 'authorizations/:id',
    title: 'Request · AuthBridge',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/authorization-detail/authorization-detail.page').then((m) => m.AuthorizationDetailPage),
  },
  {
    path: 'proposals/:id',
    title: 'Review submission · AuthBridge',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/proposal-review/proposal-review.page').then((m) => m.ProposalReviewPage),
  },
  {
    path: 'submissions/:id',
    title: 'Submission · AuthBridge',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/submission-progress/submission-progress.page').then((m) => m.SubmissionProgressPage),
  },
  { path: '**', redirectTo: 'dashboard' },
];
