require('dotenv').config();
const passport=require("passport");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { GoogleOneTapStrategy } = require("passport-google-one-tap");

const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;
const ONE_TAP_CLIENT_ID = process.env.GOOGLE_ONE_TAP_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const ONE_TAP_CLIENT_SECRET = process.env.GOOGLE_ONE_TAP_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

if (!ONE_TAP_CLIENT_ID || !ONE_TAP_CLIENT_SECRET) {
  console.warn('[OneTap] Faltan CLIENT_ID/SECRET; se intentará con los de OAuth si están definidos');
}

passport.serializeUser(function(user, done) {
    done(null, user);
});
passport.deserializeUser(function(user, done) {
    done(null, user);
});

passport.use(new GoogleStrategy({
  clientID: ONE_TAP_CLIENT_ID,
  clientSecret: ONE_TAP_CLIENT_SECRET,
  callbackURL: CALLBACK_URL
  },
    function(accessToken, refreshToken, profile, done) {
        console.log('[GoogleStrategy] profile received:', { id: profile.id, displayName: profile.displayName, emails: profile.emails ? profile.emails.length : 0 });
        return done(null, profile);
    }
));

passport.use(new GoogleOneTapStrategy(
  {
    client_id: ONE_TAP_CLIENT_ID,
    clientSecret: ONE_TAP_CLIENT_SECRET,
    verifyCsrfToken: false // en prod con HTTPS activarlo
  },
  function (profile, done) {
    console.log('[OneTapStrategy] perfil recibido en verify:', {
      id: profile && (profile.id || profile.sub),
      emails: profile && (profile.emails || profile.email),
      displayName: profile && profile.displayName
    });
    return done(null, profile);
  }
));

console.log('[passport-setup] OneTapStrategy configurada, ONE_TAP_CLIENT_ID present?', !!ONE_TAP_CLIENT_ID);