# Google OAuth App Verification Guide

Complete guide to resolving the 7-day token expiration issue for production deployments.

## Overview

The 7-day refresh token expiration is a **Google Cloud security feature** for unverified OAuth applications. This cannot be bypassed with code changes or environment variables - it requires proper OAuth app configuration in Google Cloud Console.

## The Problem

**Unverified OAuth Apps:**
- ✅ Users can grant permissions
- ⚠️ Users see "unverified app" warnings  
- ❌ **Refresh tokens expire after 7 days**
- ❌ Limited to 100 test users

**Impact on MCP Server:**
- Server stops working after 7 days
- Requires manual re-authentication
- Not suitable for production use

## The Solution

There are **three approaches** to eliminate 7-day token expiration:

### Option 1: Publish Without Verification (Quickest)

**Best for**: Personal use, internal tools, prototypes

**Steps:**
1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **OAuth consent screen**
3. Click **"PUBLISH APP"** or **"PUSH TO PRODUCTION"**
4. Confirm the action

**Results:**
- ✅ **No more 7-day expiration**
- ✅ **Unlimited users**
- ✅ **Immediate effect**
- ⚠️ **Users still see "unverified app" warnings**

### Option 2: Submit for Verification (Recommended)

**Best for**: Public applications, professional use

**Requirements:**
- Privacy Policy (publicly accessible URL)
- Terms of Service (publicly accessible URL)
- App homepage (publicly accessible URL)
- Authorized domain verification
- App review process compliance

**Steps:**
1. **Prepare Required Documents:**
   ```
   Privacy Policy: https://yourapp.com/privacy
   Terms of Service: https://yourapp.com/terms  
   Homepage: https://yourapp.com
   ```

2. **Google Cloud Console:**
   - **APIs & Services** → **OAuth consent screen**
   - Fill in all required fields
   - Add privacy policy and terms of service URLs
   - Submit for verification

3. **Verification Process:**
   - Google reviews your application
   - Timeline: 1-6 weeks
   - May require additional information

**Results:**
- ✅ **No token expiration**
- ✅ **No user warnings**
- ✅ **Unlimited users**
- ✅ **Professional appearance**

### Option 3: Internal App (Google Workspace)

**Best for**: Organization-only use

**Requirements:**
- Google Workspace domain
- Internal user type selection

**Steps:**
1. **Google Cloud Console** → **APIs & Services** → **OAuth consent screen**
2. **User Type** → **Internal**
3. Configure app for your organization

**Results:**
- ✅ **No token expiration**
- ✅ **No user warnings**
- ✅ **Immediate effect**
- ❌ **Only domain users can access**

## Step-by-Step: Publishing Without Verification

This is the fastest solution for most users:

### 1. Access Google Cloud Console
```bash
# Open in browser
https://console.cloud.google.com/
```

### 2. Navigate to OAuth Consent Screen
1. Select your project
2. **APIs & Services** → **OAuth consent screen**
3. Look for **Publishing status** section

### 3. Publish the App
1. Click **"PUBLISH APP"** or **"PUSH TO PRODUCTION"**
2. **Confirm** when prompted
3. **Status should change** to "In production"

### 4. Verify the Change
```bash
# Current status should show:
Publishing status: In production

# Test by re-authenticating your Docker container:
docker compose exec server npm run auth
```

## Verification Requirements (Option 2)

If you choose full verification, you'll need:

### Required Legal Documents

**Privacy Policy Template:**
```
# Privacy Policy for [Your App Name]

## Information We Collect
- Google Calendar data (events, calendars)
- Authentication tokens (stored securely)

## How We Use Information  
- To provide calendar integration services
- To maintain user authentication

## Data Storage
- Tokens stored locally/in secure cloud storage
- No data shared with third parties

## Contact
[Your contact information]
```

**Terms of Service Template:**
```
# Terms of Service for [Your App Name]

## Acceptance of Terms
By using this service, you agree to these terms.

## Service Description
[Describe your MCP server functionality]

## User Responsibilities
- Maintain account security
- Use service appropriately

## Contact
[Your contact information]
```

### Domain Verification
1. **Add authorized domains** in OAuth consent screen
2. **Verify domain ownership** via Google Search Console
3. **Host legal documents** on verified domains

## Docker Integration

Once your OAuth app is published/verified:

### 1. No Code Changes Required
```yaml
# docker compose.yml - no special environment variables needed
environment:
  NODE_ENV: production
  TRANSPORT: http
  # No GOOGLE_ACCOUNT_MODE needed - this doesn't affect Google's verification
```

### 2. Authentication Still Required
```bash
# Initial authentication (one-time)
docker compose exec server npm run auth

# Tokens will now persist indefinitely (until revoked)
```

### 3. Monitor Token Health
```bash
# Check token status
docker compose exec server node -e "
  const tokens = require('/home/nodejs/.config/google-calendar-mcp/tokens.json');
  console.log('Refresh token present:', !!tokens.normal?.refresh_token);
"
```

## Troubleshooting

### "App is still in testing mode"
- Check Google Cloud Console publishing status
- May take a few minutes to propagate
- Clear browser cache and re-authenticate

### "Tokens still expiring after 7 days"
```bash
# Verify publishing status in Google Cloud Console
# Re-authenticate to get new long-lived tokens
docker compose exec server npm run auth
```

### "Verification rejected"
- Review Google's OAuth policy requirements
- Ensure all required documents are accessible
- Contact Google Cloud Support for specific issues

## Security Considerations

### For Published Apps
- Monitor token usage for unusual activity
- Implement proper session management
- Use HTTPS for all communications
- Rotate client secrets periodically

### For Verified Apps
- Maintain compliance with Google policies
- Keep privacy policy and terms of service updated
- Monitor for security vulnerabilities
- Respond to Google security notifications

## Production Deployment Checklist

**Before Deployment:**
- [ ] OAuth app published to production
- [ ] Test authentication flow with long-lived tokens
- [ ] Document re-authentication procedures
- [ ] Set up monitoring for authentication failures

**OAuth App Status:**
- [ ] Publishing status: "In production" 
- [ ] Scopes: Minimal required permissions
- [ ] Redirect URIs: Match your deployment URLs
- [ ] Domain verification: Complete (if pursuing verification)

**Optional Verification:**
- [ ] Privacy policy: Publicly accessible
- [ ] Terms of service: Publicly accessible  
- [ ] App homepage: Publicly accessible
- [ ] Verification submitted: If requiring no user warnings

## Additional Resources

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [OAuth Consent Screen Help](https://support.google.com/cloud/answer/10311615)
- [OAuth App Verification](https://support.google.com/cloud/answer/13463073)
- [Scopes and Sensitive Permissions](https://developers.google.com/identity/protocols/oauth2/scopes)

## Summary

**Quick Fix (5 minutes):**
1. Google Cloud Console → OAuth consent screen
2. Click "PUBLISH APP" 
3. Re-authenticate your Docker container
4. ✅ No more 7-day expiration

**Professional Solution (1-6 weeks):**
1. Create privacy policy and terms of service
2. Submit for verification
3. Wait for Google approval
4. ✅ No expiration + no user warnings

The key insight: **This is an OAuth app configuration issue, not a code or Docker configuration issue.**