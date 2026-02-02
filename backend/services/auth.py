async def initialize_admin_user():
    """
    Διόρθωση για το σφάλμα στο Context Manager.
    Χρησιμοποιούμε απευθείας τον session_maker του db_manager.
    """
    logger.info("🎬 Initializing admin user...")
    
    # Ο db_manager έχει εσωτερικά τον session maker. 
    # Συνήθως ονομάζεται session_maker ή AsyncSessionLocal.
    # Αν το get_db είναι generator, παίρνουμε το session maker έτσι:
    session_factory = getattr(db_manager, 'session_maker', None) or \
                     getattr(db_manager, 'AsyncSessionLocal', None)

    if not session_factory:
        logger.error("❌ Could not find session maker in db_manager")
        return

    async with session_factory() as db:
        try:
            admin_email = "admin@example.com"
            admin_pass = "admin123" 
            admin_id = "admin_root"
            
            # Έλεγχος αν υπάρχει ο χρήστης
            stmt = select(User).where(User.email == admin_email)
            result = await db.execute(stmt)
            admin = result.scalar_one_or_none()

            if not admin:
                salt = secrets.token_hex(16)
                admin = User(
                    id=admin_id,
                    email=admin_email,
                    name="System Admin",
                    role="admin",
                    password_hash=hash_password(admin_pass, salt),
                    password_salt=salt,
                    is_active=True,
                    created_at=datetime.now(timezone.utc)
                )
                db.add(admin)
                await db.commit()
                await db.refresh(admin)
                logger.info("✅ Admin created successfully.")

            # Διασφάλιση Ρόλου 'admin' στον πίνακα Roles
            role_stmt = select(Roles).where(Roles.name == "admin")
            role_res = await db.execute(role_stmt)
            admin_role = role_res.scalar_one_or_none()
            
            if not admin_role:
                admin_role = Roles(name="admin", description="Full Access")
                db.add(admin_role)
                await db.commit()
                await db.refresh(admin_role)

            # Σύνδεση Χρήστη με Ρόλο στον πίνακα UserRoles
            ur_stmt = select(UserRoles).where(
                UserRoles.user_id == admin.id, 
                UserRoles.role_id == admin_role.id
            )
            ur_check = await db.execute(ur_stmt)
            if not ur_check.scalar_one_or_none():
                db.add(UserRoles(user_id=admin.id, role_id=admin_role.id, assigned_by="system"))
                await db.commit()

            logger.info("🚀 Admin initialization complete.")

        except Exception as e:
            await db.rollback()
            logger.error(f"❌ Initialization Error: {str(e)}")
