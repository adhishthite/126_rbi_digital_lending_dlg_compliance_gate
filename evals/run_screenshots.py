import subprocess
import time
import os
import sys
import httpx

GBROWSER = "/google/bin/releases/gemini-agents-gbrowser/gbrowser"

def boot_backend():
    print("Booting backend...")
    env = os.environ.copy()
    env["PYTHONPATH"] = "../backend"
    proc = subprocess.Popen(
        ["uv", "run", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8126"],
        cwd="../backend",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env
    )
    # Poll
    for _ in range(10):
        try:
            res = httpx.get("http://127.0.0.1:8126/api/config", timeout=1.0)
            if res.status_code == 200:
                print("Backend ready.")
                return proc
        except Exception:
            pass
        time.sleep(1)
    print("Backend failed to start.")
    proc.terminate()
    sys.exit(1)

def boot_frontend():
    print("Booting frontend Next.js server (production mode)...")
    proc = subprocess.Popen(
        ["pnpm", "start", "--port", "3126"],
        cwd="../frontend",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    # Poll port 3126
    for _ in range(15):
        try:
            res = httpx.get("http://127.0.0.1:3126/", timeout=1.0)
            # Accept any response (even 200/404/etc) as long as connection succeeds
            print(f"Frontend connection check: {res.status_code}")
            return proc
        except Exception:
            pass
        time.sleep(1)
    print("Frontend failed to start.")
    proc.terminate()
    sys.exit(1)

def run():
    # Make sure screenshots directory exists
    os.makedirs("../screenshots", exist_ok=True)
    
    backend_proc = boot_backend()
    frontend_proc = boot_frontend()
    
    time.sleep(2) # Extra buffer
    
    print("\nRunning gbrowser batch to capture compliance flow screenshots...")
    try:
        cmd = [GBROWSER, "batch", "screenshot_recipe.json", "--timeout=120s"]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        print("gbrowser STDOUT:")
        print(result.stdout.decode())
        print("gbrowser STDERR:")
        print(result.stderr.decode())
        
        if result.returncode == 0:
            print("Successfully captured screenshots.")
        else:
            print(f"gbrowser exited with error code {result.returncode}")
            
    except Exception as e:
        print(f"Failed to run gbrowser: {e}")
        
    finally:
        print("Terminating background servers...")
        backend_proc.terminate()
        frontend_proc.terminate()
        backend_proc.wait()
        frontend_proc.wait()
        print("Teardown complete.")

if __name__ == "__main__":
    run()
