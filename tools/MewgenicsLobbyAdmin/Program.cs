using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MewgenicsLobbyAdmin;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new LobbyAdminForm());
    }
}

public sealed class LobbyAdminForm : Form
{
    private readonly DataGridView _grid = new();
    private readonly Button _refreshButton = new();
    private readonly Button _closeAllButton = new();
    private readonly Label _statusLabel = new();
    private readonly System.Windows.Forms.Timer _refreshTimer = new();
    private readonly AdminConfig _config;
    private readonly HttpClient _httpClient = new();
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public LobbyAdminForm()
    {
        Text = "Mewgenics Lobby Admin";
        MinimumSize = new Size(880, 520);
        Size = new Size(1040, 620);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(24, 19, 15);
        ForeColor = Color.FromArgb(246, 237, 223);
        Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);

        _config = AdminConfig.Load();
        _httpClient.BaseAddress = new Uri(_config.ApiBase);
        _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _config.AdminToken);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            BackColor = BackColor,
            Margin = Padding.Empty,
            Padding = Padding.Empty
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 78F));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44F));

        layout.Controls.Add(BuildHeader(), 0, 0);
        layout.Controls.Add(BuildGrid(), 0, 1);
        layout.Controls.Add(BuildFooter(), 0, 2);
        Controls.Add(layout);

        _refreshTimer.Interval = 7000;
        _refreshTimer.Tick += async (_, _) => await RefreshLobbiesAsync();
        _refreshTimer.Start();

        Shown += async (_, _) => await RefreshLobbiesAsync();
    }

    private Control BuildHeader()
    {
        var header = new Panel
        {
            Dock = DockStyle.Fill,
            Height = 78,
            Padding = new Padding(18, 14, 18, 10),
            BackColor = Color.FromArgb(32, 25, 18)
        };

        var title = new Label
        {
            AutoSize = true,
            Text = "Mewgenics Lobby Admin",
            Font = new Font(Font, FontStyle.Bold),
            ForeColor = Color.FromArgb(255, 243, 218),
            Location = new Point(18, 14)
        };

        var subtitle = new Label
        {
            AutoSize = true,
            Text = _config.ApiBase,
            ForeColor = Color.FromArgb(169, 148, 118),
            Location = new Point(18, 43)
        };

        _closeAllButton.Text = "Закрыть все";
        _closeAllButton.Width = 128;
        _closeAllButton.Height = 38;
        _closeAllButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _closeAllButton.Location = new Point(header.Width - 292, 20);
        _closeAllButton.BackColor = Color.FromArgb(96, 39, 34);
        _closeAllButton.ForeColor = Color.FromArgb(255, 235, 228);
        _closeAllButton.FlatStyle = FlatStyle.Flat;
        _closeAllButton.FlatAppearance.BorderColor = Color.FromArgb(140, 58, 50);
        _closeAllButton.Click += async (_, _) => await CloseAllLobbiesAsync();

        _refreshButton.Text = "Обновить";
        _refreshButton.Width = 128;
        _refreshButton.Height = 38;
        _refreshButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _refreshButton.Location = new Point(header.Width - 150, 20);
        _refreshButton.BackColor = Color.FromArgb(49, 120, 112);
        _refreshButton.ForeColor = Color.White;
        _refreshButton.FlatStyle = FlatStyle.Flat;
        _refreshButton.FlatAppearance.BorderColor = Color.FromArgb(76, 154, 145);
        _refreshButton.Click += async (_, _) => await RefreshLobbiesAsync();

        header.Resize += (_, _) =>
        {
            _closeAllButton.Location = new Point(header.Width - 292, 20);
            _refreshButton.Location = new Point(header.Width - 150, 20);
        };

        header.Controls.Add(title);
        header.Controls.Add(subtitle);
        header.Controls.Add(_closeAllButton);
        header.Controls.Add(_refreshButton);

        return header;
    }

    private Control BuildGrid()
    {
        _grid.Dock = DockStyle.Fill;
        _grid.AllowUserToAddRows = false;
        _grid.AllowUserToDeleteRows = false;
        _grid.AllowUserToResizeRows = false;
        _grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _grid.BackgroundColor = Color.FromArgb(24, 19, 15);
        _grid.BorderStyle = BorderStyle.None;
        _grid.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
        _grid.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None;
        _grid.ColumnHeadersHeight = 40;
        _grid.EnableHeadersVisualStyles = false;
        _grid.GridColor = Color.FromArgb(64, 51, 39);
        _grid.MultiSelect = false;
        _grid.ReadOnly = true;
        _grid.RowHeadersVisible = false;
        _grid.RowTemplate.Height = 42;
        _grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _grid.DataError += (_, _) => { };
        _grid.CellClick += async (_, eventArgs) => await HandleGridClickAsync(eventArgs);

        _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(40, 32, 24);
        _grid.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(214, 168, 61);
        _grid.ColumnHeadersDefaultCellStyle.Font = new Font(Font, FontStyle.Bold);
        _grid.DefaultCellStyle.BackColor = Color.FromArgb(30, 24, 18);
        _grid.DefaultCellStyle.ForeColor = Color.FromArgb(246, 237, 223);
        _grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(58, 47, 36);
        _grid.DefaultCellStyle.SelectionForeColor = Color.White;

        _grid.Columns.Add(new DataGridViewButtonColumn
        {
            Name = "close",
            HeaderText = "Закрыть",
            Text = "X",
            UseColumnTextForButtonValue = true,
            AutoSizeMode = DataGridViewAutoSizeColumnMode.None,
            Width = 86,
            MinimumWidth = 86,
            FlatStyle = FlatStyle.Popup,
            DefaultCellStyle =
            {
                Alignment = DataGridViewContentAlignment.MiddleCenter,
                BackColor = Color.FromArgb(96, 39, 34),
                ForeColor = Color.FromArgb(255, 235, 228),
                SelectionBackColor = Color.FromArgb(120, 48, 42),
                SelectionForeColor = Color.White,
                Font = new Font("Segoe UI", 10F, FontStyle.Bold, GraphicsUnit.Point)
            }
        });
        _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "id", HeaderText = "ID", FillWeight = 72 });
        _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "host", HeaderText = "Хост", FillWeight = 130 });
        _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "status", HeaderText = "Статус", FillWeight = 90 });
        _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "players", HeaderText = "Игроки", FillWeight = 72 });
        _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "rounds", HeaderText = "Раунды", FillWeight = 70 });
        _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "mirror", HeaderText = "Mirror", FillWeight = 70 });
        _grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "password", HeaderText = "Пароль", FillWeight = 72 });

        return _grid;
    }

    private Control BuildFooter()
    {
        var footer = new Panel
        {
            Dock = DockStyle.Fill,
            Height = 44,
            Padding = new Padding(18, 8, 18, 8),
            BackColor = Color.FromArgb(32, 25, 18)
        };

        _statusLabel.AutoSize = true;
        _statusLabel.ForeColor = Color.FromArgb(169, 148, 118);
        _statusLabel.Text = "Готово";
        _statusLabel.Location = new Point(18, 13);

        footer.Controls.Add(_statusLabel);
        return footer;
    }

    private async Task RefreshLobbiesAsync()
    {
        await RunUiTaskAsync("Загрузка лобби...", async () =>
        {
            var response = await GetJsonAsync<LobbyListResponse>("/api/admin/lobbies");
            _grid.Rows.Clear();

            foreach (var lobby in response.Lobbies)
            {
                _grid.Rows.Add(
                    "X",
                    lobby.Id,
                    lobby.HostName,
                    StatusLabel(lobby.Status),
                    $"{lobby.PlayerCount}/{lobby.RequiredPlayers}",
                    lobby.Rounds,
                    lobby.MirrorDraft ? "Да" : "Нет",
                    lobby.HasPassword ? "Да" : "Нет"
                );
            }

            _statusLabel.Text = response.Lobbies.Count == 0
                ? "Лобби не найдены."
                : $"Лобби: {response.Lobbies.Count}. Обновлено {DateTime.Now:HH:mm:ss}.";
        });
    }

    private async Task HandleGridClickAsync(DataGridViewCellEventArgs eventArgs)
    {
        if (eventArgs.RowIndex < 0 || _grid.Columns[eventArgs.ColumnIndex].Name != "close")
        {
            return;
        }

        var lobbyId = Convert.ToString(_grid.Rows[eventArgs.RowIndex].Cells["id"].Value);
        if (string.IsNullOrWhiteSpace(lobbyId))
        {
            return;
        }

        var result = MessageBox.Show(
            $"Закрыть лобби {lobbyId}?",
            "Mewgenics Lobby Admin",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning
        );

        if (result != DialogResult.Yes)
        {
            return;
        }

        await RunUiTaskAsync($"Закрытие {lobbyId}...", async () =>
        {
            var response = await GetJsonAsync<CloseResponse>($"/api/admin/lobbies/{lobbyId}/close", HttpMethod.Post);
            _statusLabel.Text = response.Closed.Count > 0 ? $"Закрыто: {lobbyId}" : $"Лобби {lobbyId} не найдено.";
            await RefreshLobbiesAsync();
        });
    }

    private async Task CloseAllLobbiesAsync()
    {
        if (_grid.Rows.Count == 0)
        {
            _statusLabel.Text = "Лобби не найдены.";
            return;
        }

        var result = MessageBox.Show(
            "Закрыть все лобби из списка?",
            "Mewgenics Lobby Admin",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning
        );

        if (result != DialogResult.Yes)
        {
            return;
        }

        await RunUiTaskAsync("Закрытие всех лобби...", async () =>
        {
            var response = await GetJsonAsync<CloseResponse>("/api/admin/lobbies/close-all", HttpMethod.Post);
            _statusLabel.Text = response.Closed.Count > 0
                ? $"Закрыты: {string.Join(", ", response.Closed)}"
                : "Открытых/видимых лобби не найдено.";
            await RefreshLobbiesAsync();
        });
    }

    private async Task RunUiTaskAsync(string status, Func<Task> action)
    {
        SetBusy(true, status);
        try
        {
            await action();
        }
        catch (Exception exception)
        {
            _statusLabel.Text = "Ошибка.";
            MessageBox.Show(exception.Message, "Mewgenics Lobby Admin", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            SetBusy(false, _statusLabel.Text);
        }
    }

    private void SetBusy(bool busy, string status)
    {
        _statusLabel.Text = status;
        _refreshButton.Enabled = !busy;
        _closeAllButton.Enabled = !busy;
        _grid.Enabled = !busy;
        Cursor = busy ? Cursors.WaitCursor : Cursors.Default;
    }

    private async Task<T> GetJsonAsync<T>(string path, HttpMethod? method = null)
    {
        using var request = new HttpRequestMessage(method ?? HttpMethod.Get, path);
        using var response = await _httpClient.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            var error = TryReadError(body) ?? $"HTTP {(int)response.StatusCode}";
            throw new InvalidOperationException(error);
        }

        return JsonSerializer.Deserialize<T>(body, _jsonOptions)
            ?? throw new InvalidOperationException("Сервер вернул пустой ответ.");
    }

    private string? TryReadError(string body)
    {
        try
        {
            return JsonSerializer.Deserialize<ErrorResponse>(body, _jsonOptions)?.Error;
        }
        catch
        {
            return null;
        }
    }

    private static string StatusLabel(string status)
    {
        return status switch
        {
            "waiting" => "Ожидание",
            "rolling" => "Кубик",
            "drafting" => "Драфт",
            "complete" => "Итог",
            "closed" => "Закрыто",
            _ => status
        };
    }
}

public sealed record AdminConfig(string AdminToken, string ApiBase)
{
    private const string ConfigFileName = ".admin.local.json";
    private const string DefaultApiBase = "https://mewgenics-draft-system.hulore.workers.dev";

    public static AdminConfig Load()
    {
        var configPath = FindConfigPath()
            ?? throw new InvalidOperationException(
                "Не найден .admin.local.json. Запусти exe из папки проекта или положи .admin.local.json рядом с ним."
            );

        var json = File.ReadAllText(configPath).TrimStart('\uFEFF');
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var token = root.TryGetProperty("adminToken", out var tokenElement)
            ? tokenElement.GetString()
            : null;
        var apiBase = root.TryGetProperty("apiBase", out var apiBaseElement)
            ? apiBaseElement.GetString()
            : DefaultApiBase;

        if (string.IsNullOrWhiteSpace(token))
        {
            throw new InvalidOperationException(".admin.local.json не содержит adminToken.");
        }

        return new AdminConfig(token, (apiBase ?? DefaultApiBase).TrimEnd('/'));
    }

    private static string? FindConfigPath()
    {
        foreach (var seed in GetSearchSeeds())
        {
            var directory = seed;
            while (!string.IsNullOrWhiteSpace(directory))
            {
                var candidate = Path.Combine(directory, ConfigFileName);
                if (File.Exists(candidate))
                {
                    return candidate;
                }

                directory = Directory.GetParent(directory)?.FullName;
            }
        }

        return null;
    }

    private static IEnumerable<string> GetSearchSeeds()
    {
        yield return AppContext.BaseDirectory;
        yield return Environment.CurrentDirectory;
    }
}

public sealed record LobbyListResponse([property: JsonPropertyName("lobbies")] List<LobbySummary> Lobbies);

public sealed record CloseResponse([property: JsonPropertyName("closed")] List<string> Closed);

public sealed record ErrorResponse([property: JsonPropertyName("error")] string? Error);

public sealed record LobbySummary(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("hostName")] string HostName,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("playerCount")] int PlayerCount,
    [property: JsonPropertyName("requiredPlayers")] int RequiredPlayers,
    [property: JsonPropertyName("rounds")] int Rounds,
    [property: JsonPropertyName("mirrorDraft")] bool MirrorDraft,
    [property: JsonPropertyName("hasPassword")] bool HasPassword
);
