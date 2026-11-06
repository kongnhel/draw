import re

with open('D:\kong\me\views/partials/header.ejs', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the authenticated-only mood button with always-visible
content = content.replace(
    '''<% if (isAuthenticated) { %>
              <!-- Mood Selector Button (only for authenticated) -->
              <button class="nav-icon-btn nav-mood-toggle" type="button" aria-label="Select mood" data-mood-toggle>''',
'''<!-- Mood Selector Button (always visible) -->
            <button class="nav-icon-btn nav-mood-toggle" type="button" aria-label="Select mood" data-mood-toggle>'''

)

# Ensure the mood panel is after the nav-actions (outside auth check)
# The panel should be after the closing <% } %> of the authenticated block
panel_pattern = '''<% } else { %>
              <a href="/login" class="nav-auth-link">Login</a>
              <a href="/register" class="nav-auth-join">Join</a>
            <% } %>'''

panel_insert = '''<% } else { %>
              <a href="/login" class="nav-auth-link">Login</a>
              <a href="/register" class="nav-auth-join">Join</a>
            <% } %>

            <!-- Mood Selector Button (always visible) -->
            <button class="nav-icon-btn nav-mood-toggle" type="button" aria-label="Select mood" data-mood-toggle>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c-3 1-5-3-5-5V7c0-2 3-3 5-3s5 1 5 3v7c0 2-3 3-5 3zM6 7c-2.76 0-5 2.24-5 5s2.24 5 5 5v7c0 2-4.38 3-7 3s-7-1.76-7-3v-7c0-3-1.76-5-5-5zm1.5 2.5c-.97 0-1.76-.77-1.76-1.71l-.01-.15A5.51 5.51 0 0 0 12 4.5c-.92 0-1.74.35-2.33.94l-.01.12c.03-.97.08-1.95.08-3s-.97-1.03-.08-3l-.01.15c-.01.01-.97.77-1.73 1.73l-.15.01A5.5 5.5 0 0 0 12 15.5c0 .97.77 1.76 1.73.94l.12-.01z" /></svg>
              <span>Mood</span>
            </button>
            <!-- /Mood Selector Button -->'''

content = content.replace(panel_pattern, panel_insert)

# Fix the mood panel titles - ensure proper emoji
content = content.replace('title="COOL ❄️"', 'title="COOL ❄️"')
content = content.replace('title="LOVE 💕"', 'title="LOVE 💕"')
content = content.replace('title="ROMANTIC 🌹"', 'title="ROMANTIC 🌹"')
content = content.replace('title="SAD 🌧️"', 'title="SAD 🌧️"')

# Fix the mood toggle button text to always show "Mood"
content = re.sub(
    r'<button class="nav-icon-btn nav-mood-toggle" type="button" aria-label="Select mood" data-mood-toggle>.*?</svg>\s*<!-- /Mood Selector Button -->',
    '''<button class="nav-icon-btn nav-mood-toggle" type="button" aria-label="Select mood" data-mood-toggle>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c-3 1-5-3-5-5V7c0-2 3-3 5-3s5 1 5 3v7c0 2-3 3-5 3zM6 7c-2.76 0-5 2.24-5 5s2.24 5 5 5v7c0 2-4.38 3-7 3s-7-1.76-7-3v-7c0-3-1.76-5-5-5zm1.5 2.5c-.97 0-1.76-.77-1.76-1.71l-.01-.15A5.51 5.51 0 0 0 12 4.5c-.92 0-1.74.35-2.33.94l-.01.12c.03-.97.08-1.95.08-3s-.97-1.03-.08-3l-.01.15c-.01.01-.97.77-1.73 1.73l-.15.01A5.5 5.5 0 0 0 12 15.5c0 .97.77 1.76 1.73.94l.12-.01z" /></svg>
            <span>Mood</span>
            </button>''',
    content
)

with open('D:\kong\me\views/partials/header.ejs', 'w', encoding='utf-8') as f:
    f.write(content)
print('Header fixed')