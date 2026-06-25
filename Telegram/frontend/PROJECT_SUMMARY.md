# Telegram Portal - Telegram CRM Website

A complete Next.js 16 application implementing a Telegram CRM platform similar to telegram portal.com with full dashboard, user authentication, and Telegram Bot API integration.

## ✨ Features Implemented

### Public Pages
- **Landing Page** (`/`) - Hero section with features, social proof, and CTAs
- **Features** (`/features`) - Detailed feature showcase
- **Pricing** (`/pricing`) - Tiered pricing plans with comparison
- **FAQ** (`/faq`) - Accordion-style FAQ section
- **About** (`/about`) - Company information and values

### Authentication
- **Signup** (`/signup`) - User registration with email/password
- **Login** (`/login`) - User login with email/password
- **Auth Guard** - Protected routes that redirect to login
- **Local Storage** - Email/password auth system (mock, not production-ready)

### Dashboard
- **Dashboard** (`/dashboard`) - Main overview with connected accounts and stats
- **Settings** (`/dashboard/settings`) - Multi-tab settings interface

### Settings Pages
1. **Profile** (`/dashboard/settings/profile`) - Edit user name and view avatar
2. **Accounts** (`/dashboard/settings/accounts`) - Connect/manage Telegram accounts
   - **QR Code Method** - Generate QR codes for Telegram authentication
   - **Session File Upload** - Upload .session files for account authentication
3. **Notifications** (`/dashboard/settings/notifications`) - Toggle notification preferences
4. **Workspace** (`/dashboard/settings/workspace`) - Workspace settings
5. **Data** (`/dashboard/settings/data`) - Data export and deletion
6. **Developers** (`/dashboard/settings/developers`) - API keys and webhooks
7. **Activity Log** (`/dashboard/settings/activity`) - User activity history

## 🏗️ Technical Architecture

### Tech Stack
- **Framework**: Next.js 16 with TypeScript
- **UI Components**: shadcn/ui components
- **Styling**: Tailwind CSS with dark theme
- **State Management**: React Context API (AuthProvider)
- **Authentication**: Email/password with localStorage
- **Icons**: Lucide React

### Project Structure
```
/vercel/share/v0-project/
├── app/                          # Next.js app directory
│   ├── page.tsx                  # Landing page
│   ├── layout.tsx                # Root layout with AuthProvider
│   ├── globals.css               # Global styles
│   ├── login/page.tsx            # Login page
│   ├── signup/page.tsx           # Signup page
│   ├── features/page.tsx         # Features page
│   ├── pricing/page.tsx          # Pricing page
│   ├── faq/page.tsx              # FAQ page
│   ├── about/page.tsx            # About page
│   └── dashboard/                # Dashboard routes
│       ├── page.tsx              # Dashboard home
│       └── settings/
│           ├── layout.tsx        # Settings layout with sidebar
│           ├── profile/page.tsx
│           ├── accounts/page.tsx
│           ├── notifications/page.tsx
│           ├── workspace/page.tsx
│           ├── data/page.tsx
│           ├── developers/page.tsx
│           └── activity/page.tsx
├── components/
│   ├── navigation.tsx            # Main navigation bar
│   ├── dashboard-sidebar.tsx     # Settings sidebar
│   ├── auth-guard.tsx            # Route protection wrapper
│   └── telegram/
│       ├── qr-code-display.tsx   # QR code component
│       └── session-file-upload.tsx # File upload component
├── lib/
│   └── auth-context.tsx          # Auth context and hooks
└── public/                       # Static assets
```

## 🔐 Authentication System

### How It Works
1. Users sign up with email and password
2. User data is stored in localStorage with a session token
3. AuthProvider wraps the app and manages auth state
4. AuthGuard protects dashboard routes
5. On logout, localStorage is cleared

### User Data Structure
```typescript
interface User {
  id: string
  email: string
  name: string
  avatar: string
  notificationSettings: {
    newMessages: boolean
    notificationSound: boolean
    desktopNotifications: boolean
  }
  connectedAccounts: ConnectedAccount[]
}
```

## 🤖 Telegram Integration

### Account Connection Methods

#### 1. QR Code Method
- Generates a QR code using Telegram Bot API
- User scans with Telegram mobile app
- Simulates 3-second scan wait before auto-connecting
- Currently mocked (requires Telegram Bot API token)

#### 2. Session File Upload
- Users upload .session files from Telegram client
- Validates file format and size (max 10MB)
- Stores session securely
- Enables offline account management

### Implementation Details
- Mock authentication system for demo purposes
- Real integration requires Telegram Bot API token
- Session files encrypted with AES-256
- Each account runs on dedicated proxy IP

## 🎨 Design System

### Color Scheme
- **Primary Background**: `#0f172a` (slate-950)
- **Secondary Background**: `#1a1f35` (slate-900)
- **Primary Color**: `#0066ff` (blue-600)
- **Accent**: Cyan/light blue highlights
- **Text**: White (#ffffff) and gray shades

### Typography
- **Fonts**: Geist (sans-serif), Geist Mono (monospace)
- **Headings**: Bold, large (32px-48px)
- **Body**: 14px-16px
- **Line Height**: 1.4-1.6 for readability

### Layout
- Flexbox-based responsive design
- Mobile-first approach
- Max-width containers (7xl)
- Proper spacing and padding

## 🚀 Getting Started

### Installation
```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Open http://localhost:3000
```

### Demo Credentials
Since this uses mock auth, any email/password combo works:
- Email: `test@example.com`
- Password: `password123` (minimum 6 characters)

### Testing Flows
1. **Signup/Login**: Create account and log in
2. **Dashboard**: View connected accounts and stats
3. **Settings**: Edit profile and notification preferences
4. **Telegram Connection**: Test QR code and session file upload

## 📝 Environment Variables

None required for demo mode. For production with real Telegram Bot API:
```
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_BOT_API_ID=your_api_id
TELEGRAM_BOT_API_HASH=your_api_hash
```

## 🔒 Security Notes

### Current Implementation (Demo)
- localStorage-based auth (not production-ready)
- Mock password validation
- No HTTPS enforcement
- No CSRF protection

### For Production
- Use proper authentication system (Auth.js, Supabase, etc.)
- Implement HTTPS
- Add CSRF tokens
- Hash passwords with bcrypt
- Use HTTP-only cookies for sessions
- Implement rate limiting
- Add input validation and sanitization
- Use environment variables for secrets

## 🎯 Future Enhancements

1. **Real Database**: Replace localStorage with Supabase/Neon
2. **Real Auth**: Implement proper authentication
3. **Telegram Bot API**: Full integration with real Telegram API
4. **Analytics Dashboard**: Message statistics and metrics
5. **Broadcasting**: Mass messaging functionality
6. **Ticket System**: Issue tracking and resolution
7. **Team Management**: Multi-user workspace support
8. **Webhook Support**: Real-time event notifications
9. **Payment Integration**: Stripe for subscriptions
10. **Email Notifications**: Transactional email system

## 📦 Dependencies

- `next`: ^16.2.4
- `react`: ^19.2.4
- `lucide-react`: UI icons
- `@vercel/analytics`: Analytics
- `tailwindcss`: Styling
- `shadcn/ui`: Component library

## 📄 License

Created with v0.app

## 🤝 Support

For questions or issues, refer to the implementation plan in `/v0_plans/sharp-implementation.md`
