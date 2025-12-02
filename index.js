require('dotenv').config();
const axios = require('axios');
const { chromium } = require('playwright');

const LOGIN_URL = process.env.KITE_LOGIN_URL || 'https://kite.zerodha.com/connect/login?v=3&api_key=tut3e5y01sw5fi4f';
const GET_OTP_WEBHOOK = process.env.GET_OTP_WEBHOOK || 'https://n8n.sallytion.qzz.io/webhook/get-totp';
const POST_FINAL_WEBHOOK = process.env.POST_FINAL_WEBHOOK || 'https://n8n.sallytion.qzz.io/webhook-test/kite-auth';
const USER_ID = process.env.KITE_USER || process.env.KITE_USER_ID;
const PASSWORD = process.env.KITE_PASSWORD;

if (!USER_ID || !PASSWORD) {
  console.error('Missing credentials: set KITE_USER and KITE_PASSWORD in environment or .env');
  process.exit(1);
}

async function fillIfExists(page, selectors, value) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.fill(String(value));
        return true;
      }
    } catch (e) {
      // ignore selector errors and try next
    }
  }
  return false;
}

async function clickIfExists(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        return true;
      }
    } catch (e) {
      // ignore and continue
    }
  }
  return false;
}

(async () => {
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const browser = await chromium.launch({ headless: isCI });
  const page = await browser.newPage();
  try {
    console.log('Navigating to login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });

    // Fill user id
    const userSelectors = [
      '#userid',
      'input#userid',
      'input[name="user_id"]',
      'input[name="username"]',
      'input[placeholder*="User"]',
      'input[type="text"]'
    ];
    const filledUser = await fillIfExists(page, userSelectors, USER_ID);
    if (!filledUser) console.warn('Could not find user-id field automatically; please update selectors in index.js');

    // Fill password
    const passSelectors = [
      '#password',
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="Password"]'
    ];
    const filledPass = await fillIfExists(page, passSelectors, PASSWORD);
    if (!filledPass) console.warn('Could not find password field automatically; please update selectors in index.js');

    // Click login
    const loginButtonSelectors = [
      'button[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      'button:has-text("Sign in")'
    ];
    const clickedLogin = await clickIfExists(page, loginButtonSelectors);
    if (!clickedLogin) {
      // try pressing Enter on password field
      console.log('Submitting by pressing Enter...');
      await page.keyboard.press('Enter');
    }

    // Wait for OTP input or navigation to appear
    console.log('Waiting for OTP input or navigation...');
    // Try to detect OTP input
    const otpFieldSelectors = [
      'input[name="otp"]',
      'input[autocomplete="one-time-code"]',
      'input[type="tel"]',
      'input[placeholder*="PIN"]',
      'input[placeholder*="OTP"]',
      'input' // fallback
    ];

    // Give some time for the OTP page to load
    await page.waitForTimeout(1500);

    // Request OTP from webhook
    console.log(`Requesting OTP from webhook: ${GET_OTP_WEBHOOK}`);
    let token;
    try {
      const res = await axios.get(GET_OTP_WEBHOOK, { timeout: 15000 });
      if (res && res.data) {
        token = res.data.token || res.data.otp || res.data.TOKEN || res.data.OTP;
      }
    } catch (err) {
      console.error('Failed to fetch OTP from webhook:', err.message || err);
    }

    if (!token) {
      console.log('No token received yet. Trying a second time after short wait...');
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res2 = await axios.get(GET_OTP_WEBHOOK, { timeout: 15000 });
        if (res2 && res2.data) token = res2.data.token || res2.data.otp;
      } catch (e) {
        console.error('Second attempt to fetch OTP failed:', e.message || e);
      }
    }

    if (!token) {
      throw new Error('OTP token not retrieved from webhook. Aborting.');
    }

    console.log('OTP token received:', token);

    // Paste OTP into first matching OTP field
    let otpFilled = false;
    for (const sel of otpFieldSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.fill(String(token));
          otpFilled = true;
          break;
        }
      } catch (e) {
        // continue
      }
    }

    if (!otpFilled) {
      console.warn('Could not automatically fill OTP field; please update selectors in index.js');
      throw new Error('OTP field not found');
    }

    // Submit OTP — try common buttons or press Enter
    const submitSelectors = ['button[type="submit"]', 'button:has-text("Submit")', 'button:has-text("Verify")'];
    const clickedSubmit = await clickIfExists(page, submitSelectors);
    if (!clickedSubmit) await page.keyboard.press('Enter');

    // Wait for redirect to target URL
    console.log('Waiting for redirect to n8n.sallytion.qzz.io...');
    const targetBaseUrl = 'https://n8n.sallytion.qzz.io';
    
    // Wait until URL starts with the target base URL
    await page.waitForURL(url => url.startsWith(targetBaseUrl), { timeout: 60000 });
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    const finalUrl = page.url();
    console.log('Final URL after login/OTP:', finalUrl);
    console.log('Redirect URL:', finalUrl);

    console.log('Login completed successfully.');

  } catch (err) {
    console.error('Error during flow:', err && err.message ? err.message : err);
  } finally {
    // Close the browser immediately after completion
    console.log('Done — closing browser.');
    await browser.close();
  }
})();
