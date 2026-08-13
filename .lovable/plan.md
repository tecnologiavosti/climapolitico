# Plan: Admin Users Analytics Dashboard

The user wants to add analytics charts to the "Admin Users" page, specifically tracking user growth, new users, and recent access.

## Proposed Changes

### 1. Database/Backend Updates (Optional but likely needed)
- Ensure we have enough data points (created_at is already in `profiles`).
- We might need a `last_sign_in_at` or similar if we want "recent access" beyond just "new users". *Wait, I'll check if I can derive this or if I should just use `created_at` for growth/new users.*

### 2. Frontend: src/pages/dashboard/AdminUsers.tsx
- Add a new section for analytics at the top or in a separate tab.
- Implement charts using `recharts` (standard in the project).
- Charts to include:
    - **Crescimento de Usuários (Total Accumulation)**: A line chart showing total users over time.
    - **Novos Usuários (Daily/Weekly Bar Chart)**: A bar chart showing new signups per period.
    - **Distribuição por Plano**: A pie chart showing the user base distribution across tiers (Free, Pro, etc.).
- Add a toggle or tabs to switch between the User Table and the Analytics View.

### 3. Implementation Details
- Process the `users` data from React Query to generate chart data locally in the component.
- Use `lucide-react` icons for chart indicators.

## Technical Details
- **UI Components**: `Card`, `CardContent`, `CardHeader`, `CardTitle` from shadcn.
- **Charts**: `ResponsiveContainer`, `LineChart`, `BarChart`, `PieChart`, `XAxis`, `YAxis`, `Tooltip` from `recharts`.
- **Data processing**: `useMemo` to group users by date from `created_at`.
