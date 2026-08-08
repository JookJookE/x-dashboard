# 🤖 AGENT RULES & WORKFLOW INSTRUCTIONS

> **MUST READ BEFORE WORKING IN THIS REPOSITORY**

1. **Check `PROJECT_SPEC.md` First**:
   - Before implementing any change, bug fix, or feature request, you **MUST** read [PROJECT_SPEC.md](file:///C:/Users/k3ide/Desktop/X/PROJECT_SPEC.md) to understand all established business rules, scraping timeframes, and prompt modes.

2. **Strict Directive Adherence**:
   - **Scraping Timeframe**: Tech & Finance MUST remain `2h` (`when:2h`). Community MUST remain `5d` (`when:5d`). NEVER change these without explicit user instruction.
   - **Scheduler**: Cron schedule MUST remain `0 * * * *` (hourly).
   - **Retention**: Scraped articles DB retention MUST remain 5 days.

3. **Update Documentation**:
   - Whenever you complete a feature update, prompt change, or bug fix requested by the user, you **MUST** update the `PROJECT_SPEC.md` file (specifically Section 5: Version History & Changelog) and increment the version number accordingly.

4. **Local & Render Synchronization (Git Push)**:
   - To ensure both the local environment (Mini PC/Laptop) and the remote environment (Render) stay synchronized, you **MUST** immediately commit and push any code or configuration changes to the GitHub repository (`origin main`) after completing a task.
