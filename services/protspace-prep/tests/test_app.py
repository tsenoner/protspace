async def test_healthz_reports_ok_and_zero_jobs(client):
    response = await client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["jobs"] == {"running": 0, "queued": 0}
